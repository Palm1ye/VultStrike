import { Injectable, Logger } from "@nestjs/common";
import Docker from "dockerode";
import { db } from "../drizzle/client";
import { match as matchTable } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { existsSync } from "fs";
import { createServer } from "net";
import { createSocket } from "dgram";
import { Readable } from "stream";

type ServerStatus = 'PENDING' | 'PULLING_IMAGE' | 'STARTING' | 'READY' | 'FAILED';

@Injectable()
export class DockerService {
  private static readonly MIN_USER_PORT = 1024;
  private static readonly MAX_PORT = 65535;
  private static readonly DEFAULT_AUTO_PORT_MIN = 20000;
  private static readonly DEFAULT_AUTO_PORT_MAX = 32767;
  private readonly docker = new Docker();
  private readonly logger = new Logger(DockerService.name);
  private useMockMode = process.env.CS2_MOCK_MODE === "true" || !process.env.CS2_IMAGE;
  private readonly apiBaseUrl = this.resolveApiBaseUrl();
  private readonly cs2HostDir = this.resolveCs2HostDir();

  private resolveApiBaseUrl(): string {
    const candidates = [
      process.env.API_PUBLIC_URL,
      process.env.API_INTERNAL_URL,
      process.env.WEBHOOK_URL
    ]
      .map((v) => (v ?? "").trim())
      .filter(Boolean);

    if (candidates.length) {
      return candidates[0]!;
    }

    // Fallback for local/dev when API_PUBLIC_URL is not set.
    return "http://host.docker.internal:4000";
  }

  private resolveCs2HostDir(): string {
    const configured = (process.env.CS2_HOST_DIR ?? "").trim();
    if (configured) {
      return configured;
    }

    const steamLibraryDir = "/home/steam/Steam/steamapps/common/Counter-Strike Global Offensive";
    const legacySteamLibraryDir = "/home/steam/steam/steamapps/common/Counter-Strike Global Offensive";
    const legacyDir = "/home/steam/cs2";
    if (existsSync(`${steamLibraryDir}/game/bin/linuxsteamrt64/cs2`)) {
      return steamLibraryDir;
    }
    if (existsSync(`${legacySteamLibraryDir}/game/bin/linuxsteamrt64/cs2`)) {
      return legacySteamLibraryDir;
    }
    return legacyDir;
  }

  private getPrimaryMatchWebhookSecret(): string {
    const raw = (process.env.MATCH_WEBHOOK_SECRET ?? "").trim();
    if (!raw) return "";
    return raw.split(",")[0]?.trim() ?? "";
  }

  private async updateServerStatus(matchId: string, status: ServerStatus, error?: string) {
    try {
      await db.update(matchTable)
        .set({ 
          serverStatus: status,
          ...(error ? { serverError: error } : {})
        })
        .where(eq(matchTable.id, matchId));
      this.logger.log(`Updated server status for match ${matchId}: ${status}`);
    } catch (e) {
      this.logger.error(`Failed to update server status: ${e}`);
    }
  }

  async startCs2Server(options: {
    matchId: string;
    map: string;
    workshopId?: string;
    port: number;
    lobbyCode: string;
    region: string;
    env?: Record<string, string>;
  }): Promise<{ containerId: string; endpoint: string }> {
    // Use mock mode if configured or if no CS2 image is set
    if (this.useMockMode) {
      this.logger.log(`[MOCK] Starting CS2 server for match ${options.matchId} on port ${options.port}`);
      
      await this.updateServerStatus(options.matchId, 'STARTING');
      
      // Simulate a delay for server startup
      await this.delay(500);
      
      const mockContainerId = `mock-${options.matchId}-${Date.now()}`;
      const host = process.env.GAME_SERVER_HOST ?? "localhost";
      const endpoint = `${host}:${options.port}`;
      
      await this.updateServerStatus(options.matchId, 'READY');
      // Persist endpoint + container for mock mode so dashboards can render connect info.
      await db.update(matchTable)
        .set({
          serverStatus: 'READY',
          containerId: mockContainerId,
          serverEndpoint: `connect ${endpoint}`
        })
        .where(eq(matchTable.id, options.matchId));
      this.logger.log(`[MOCK] CS2 server ready: ${mockContainerId} at ${endpoint}`);
      
      return {
        containerId: mockContainerId,
        endpoint
      };
    }

    // Real Docker mode
    const image = process.env.CS2_IMAGE ?? "cm2network/cs2:latest";
    const containerName = `cs2-match-${options.matchId}`;
    let port = options.port;
    const host = process.env.GAME_SERVER_HOST ?? "87.98.241.215";
    const shmSizeMb = Number(process.env.CS2_SHM_SIZE_MB ?? 512);
    const shmSize = Number.isFinite(shmSizeMb) && shmSizeMb > 0 ? Math.floor(shmSizeMb * 1024 * 1024) : undefined;
    const nofileLimit = Number(process.env.CS2_NOFILE_LIMIT ?? 1048576);
    const ulimits =
      Number.isFinite(nofileLimit) && nofileLimit > 0
        ? [{ Name: "nofile", Soft: Math.floor(nofileLimit), Hard: Math.floor(nofileLimit) }]
        : undefined;
    const init = (process.env.CS2_INIT ?? "true").toLowerCase() === "true";
    const buildEnv = (portValue: number) => [
      `VS_MATCH_ID=${options.matchId}`,
      `VS_MAP=${options.map}`,
      `VS_LOBBY_CODE=${options.lobbyCode}`,
      `VS_REGION=${options.region}`,
      ...(options.workshopId ? [`VS_WORKSHOP_ID=${options.workshopId}`] : []),
      `VS_WEBHOOK_URL=${this.apiBaseUrl.replace(/\/$/, '')}/matches/webhook/result`,
      `VS_WEBHOOK_SECRET=${this.getPrimaryMatchWebhookSecret()}`,
      `VS_TARGET_WINS=${process.env.CS2_TARGET_WINS ?? '13'}`,
      // Plugin behavior knobs (defaults are safe for production).
      `VS_AUTO_SHUTDOWN=${process.env.CS2_AUTO_SHUTDOWN ?? '0'}`,
      `VS_SHUTDOWN_DELAY=${process.env.CS2_SHUTDOWN_DELAY ?? '30'}`,
      `VS_PUBLIC_PORT=${portValue}`,
      `VS_PUBLIC_HOST=${host}`,
      `VS_API_BASE=${this.apiBaseUrl.replace(/\/$/, '')}`,
      `STEAM_GSLT=${process.env.CS2_GSLT ?? process.env.STEAM_GSLT ?? ''}`,
      `STEAM_AUTHKEY=${process.env.STEAM_AUTHKEY ?? process.env.STEAM_API_KEY ?? ''}`,
      `STEAM_API_KEY=${process.env.STEAM_API_KEY ?? ''}`,
      ...(options.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : [])
    ];

    try {
      // Update status: pulling image
      await this.updateServerStatus(options.matchId, 'PULLING_IMAGE');
      
      // Check if image exists locally, pull if not
      await this.ensureImage(image);
      
      // Update status: starting container
      await this.updateServerStatus(options.matchId, 'STARTING');

      const maxAttempts = Math.max(5, Number(process.env.CS2_PORT_ALLOCATE_ATTEMPTS ?? 40));
      const attempted = new Set<number>();
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attempted.add(port);
        try {
          const container = await this.docker.createContainer({
            Image: image,
            name: containerName,
            Labels: {
              "com.vultstrike.kind": "cs2-match",
              "com.vultstrike.matchId": options.matchId,
              "com.vultstrike.lobbyCode": options.lobbyCode,
              "com.vultstrike.region": options.region,
              "com.vultstrike.map": options.map,
              "com.vultstrike.port": String(port),
              ...(options.workshopId ? { "com.vultstrike.workshopId": options.workshopId } : {})
            },
            Env: buildEnv(port),
            // CS2 tends to shut down more cleanly on SIGINT than SIGTERM in some builds.
            StopSignal: "SIGINT",
            HostConfig: {
              // Use host networking so the CS2 server binds directly to the
              // allocated host port.  Docker 28+ no longer adds filter ACCEPT
              // rules for bridge-mode published ports, which silently drops all
              // external game traffic.  Host networking avoids iptables issues
              // entirely and gives lower latency for real-time game traffic.
              NetworkMode: "host",
              ...(typeof shmSize === "number" ? { ShmSize: shmSize } : {}),
              ...(ulimits ? { Ulimits: ulimits as any } : {}),
              Init: init,
              // Use existing CS2 installation from host
              Binds: [
                `${this.cs2HostDir}:/home/steam/cs2-dedicated`,
                "/home/steam/Steam:/home/steam/Steam",
                "/home/steam/Steam/steamapps:/home/steam/steamapps",
                // Provide Steam client libraries for server auth
                "/home/steam/.steam:/home/steam/.steam"
              ],
              AutoRemove: false
            }
          });

          await container.start();

          // Fail fast if the container exits immediately (for example missing
          // Metamod/CounterStrikeSharp runtime or broken entrypoint config).
          await new Promise((resolve) => setTimeout(resolve, 2500));
          const startedInfo = await container.inspect();
          if (!startedInfo?.State?.Running) {
            const exitCode = startedInfo?.State?.ExitCode;
            let details = `CS2 container exited immediately after startup (exit=${exitCode ?? 'unknown'})`;
            try {
              const logBuffer = await container.logs({ stdout: true, stderr: true, tail: 80 });
              const raw = logBuffer.toString('utf8').replaceAll("\0", "");
              const lastLine = raw
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(-1)[0];
              if (lastLine) {
                details = `${details}: ${lastLine}`;
              }
            } catch {
              // Best effort only.
            }
            throw new Error(details);
          }

          const endpoint = `${host}:${port}`;

          // Update status: ready and save container ID
          await db
            .update(matchTable)
            .set({
              serverStatus: 'READY',
              containerId: container.id,
              serverEndpoint: `connect ${endpoint}`
            })
            .where(eq(matchTable.id, options.matchId));

          this.logger.log(`Started CS2 server container: ${container.id} at ${endpoint}`);
          return {
            containerId: container.id,
            endpoint
          };
        } catch (error) {
          lastError = error;
          const errorMsg = error instanceof Error ? error.message : String(error);

          if (this.isPortAllocationError(errorMsg) && attempt < maxAttempts) {
            this.logger.warn(`Port ${port} unavailable for match ${options.matchId}. Retrying with another port. (${errorMsg})`);
            // If Docker managed to create the container before failing to start (common with port binding errors),
            // the name will be reserved. Remove it before retrying.
            try {
              await this.docker.getContainer(containerName).remove({ force: true });
            } catch {
              // Best effort.
            }
            port = await this.allocatePort({ exclude: attempted });
            continue;
          }

          throw error;
        }
      }

      const errorMsg = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
      this.logger.error(`Failed to start CS2 server container after ${maxAttempts} attempts: ${errorMsg}`);
      await this.updateServerStatus(options.matchId, 'FAILED', errorMsg.substring(0, 255));
      throw lastError;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start CS2 server container: ${errorMsg}`);
      await this.updateServerStatus(options.matchId, 'FAILED', errorMsg.substring(0, 255));
      throw error;
    }
  }

  private parsePortRange(range?: string): number[] {
    if (!range) return [];
    const trimmed = range.trim();
    if (!trimmed) return [];

    const sanitize = (value: number): number | null => {
      if (!Number.isFinite(value)) return null;
      const port = Math.floor(value);
      if (port < DockerService.MIN_USER_PORT || port > DockerService.MAX_PORT) return null;
      return port;
    };

    if (trimmed.includes("-")) {
      const [startRaw, endRaw] = trimmed.split("-");
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
      const lowRaw = Math.min(start, end);
      const highRaw = Math.max(start, end);
      const low = sanitize(lowRaw);
      const high = sanitize(highRaw);
      if (low == null || high == null) return [];
      const ports: number[] = [];
      for (let p = low; p <= high; p += 1) ports.push(p);
      return ports;
    }
    const ports = trimmed
      .split(",")
      .map((p) => Number(p.trim()))
      .map((p) => sanitize(p))
      .filter((p): p is number => p != null);
    return Array.from(new Set(ports)).sort((a, b) => a - b);
  }

  private getAutoPortRange(): number[] {
    const minRaw = Number(process.env.CS2_PORT_AUTO_MIN ?? DockerService.DEFAULT_AUTO_PORT_MIN);
    const maxRaw = Number(process.env.CS2_PORT_AUTO_MAX ?? DockerService.DEFAULT_AUTO_PORT_MAX);
    const minSanitized = Number.isFinite(minRaw) ? Math.floor(minRaw) : DockerService.DEFAULT_AUTO_PORT_MIN;
    const maxSanitized = Number.isFinite(maxRaw) ? Math.floor(maxRaw) : DockerService.DEFAULT_AUTO_PORT_MAX;
    const low = Math.max(DockerService.MIN_USER_PORT, Math.min(minSanitized, maxSanitized));
    const high = Math.min(DockerService.MAX_PORT, Math.max(minSanitized, maxSanitized));
    const ports: number[] = [];
    for (let p = low; p <= high; p += 1) ports.push(p);
    return ports;
  }

  private resolvePortPool(): { ports: number[]; label: string } {
    const configuredRange = (process.env.CS2_PORT_RANGE ?? "").trim();
    const configuredPorts = this.parsePortRange(configuredRange);
    if (configuredPorts.length > 0) {
      return { ports: configuredPorts, label: configuredRange };
    }

    const autoPorts = this.getAutoPortRange();
    if (autoPorts.length === 0) {
      throw new Error("No valid auto port range available (check CS2_PORT_AUTO_MIN/CS2_PORT_AUTO_MAX)");
    }
    const label = `auto:${autoPorts[0]}-${autoPorts[autoPorts.length - 1]}`;
    return { ports: autoPorts, label };
  }

  private async isTcpPortAvailable(port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const server = createServer();
      let settled = false;

      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try {
          server.close();
        } catch {
          // noop
        }
        resolve(ok);
      };

      server.once("error", () => done(false));
      server.once("listening", () => {
        server.close((err) => done(!err));
      });

      try {
        server.unref();
        server.listen(port, "0.0.0.0");
      } catch {
        done(false);
      }
    });
  }

  private async isUdpPortAvailable(port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const socket = createSocket("udp4");
      let settled = false;

      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          // noop
        }
        resolve(ok);
      };

      socket.once("error", () => done(false));
      socket.once("listening", () => done(true));

      try {
        socket.unref();
        socket.bind(port, "0.0.0.0");
      } catch {
        done(false);
      }
    });
  }

  private async isHostPortAvailable(port: number): Promise<boolean> {
    const [tcpAvailable, udpAvailable] = await Promise.all([
      this.isTcpPortAvailable(port),
      this.isUdpPortAvailable(port)
    ]);
    return tcpAvailable && udpAvailable;
  }

  private isPortAllocationError(message: string): boolean {
    const m = (message ?? "").toLowerCase();
    return (
      m.includes("port is already allocated") ||
      m.includes("address already in use") ||
      m.includes("failed to bind") ||
      m.includes("bind for 0.0.0.0") ||
      m.includes("listen tcp") ||
      m.includes("listen udp")
    );
  }

  async allocatePort(options?: { exclude?: Set<number> }): Promise<number> {
    const { ports: range, label } = this.resolvePortPool();

    const exclude = options?.exclude ?? new Set<number>();
    const used = new Set<number>();
    const containers = await this.docker.listContainers({ all: true });
    for (const container of containers) {
      // Bridge-mode containers expose ports in the Ports array.
      for (const port of container.Ports ?? []) {
        if (typeof port.PublicPort === "number") {
          used.add(port.PublicPort);
        }
      }
      // Host-network containers store the allocated port in a label instead.
      const labelPort = Number(container.Labels?.["com.vultstrike.port"]);
      if (Number.isFinite(labelPort) && labelPort > 0) {
        used.add(labelPort);
      }
    }

    const available = range.filter((candidate) => !used.has(candidate) && !exclude.has(candidate));
    if (available.length === 0) {
      throw new Error(`No available CS2 ports in pool ${label}`);
    }

    // Randomize start point to reduce contention under concurrent allocations.
    const startOffset = Math.floor(Math.random() * available.length);
    for (let i = 0; i < available.length; i += 1) {
      const candidate = available[(startOffset + i) % available.length]!;
      if (await this.isHostPortAvailable(candidate)) {
        return candidate;
      }
    }

    throw new Error(`No bindable CS2 ports in pool ${label}`);
  }

  async getPortCapacity(): Promise<{ range: string | null; total: number; used: number; free: number } | null> {
    const { ports, label } = this.resolvePortPool();
    if (ports.length === 0) return null;

    const portSet = new Set<number>(ports);
    const used = new Set<number>();
    const containers = await this.docker.listContainers({ all: true });
    for (const container of containers) {
      for (const port of container.Ports ?? []) {
        if (typeof port.PublicPort === "number" && portSet.has(port.PublicPort)) {
          used.add(port.PublicPort);
        }
      }
      const labelPort = Number(container.Labels?.["com.vultstrike.port"]);
      if (Number.isFinite(labelPort) && labelPort > 0 && portSet.has(labelPort)) {
        used.add(labelPort);
      }
    }

    const total = ports.length;
    const usedCount = used.size;
    const free = Math.max(0, total - usedCount);
    return { range: label, total, used: usedCount, free };
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      this.logger.debug(`Image ${image} already exists locally`);
    } catch {
      this.logger.log(`Pulling image ${image}...`);
      const stream = await this.docker.pull(image);
      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
      this.logger.log(`Image ${image} pulled successfully`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stopContainer(containerId: string) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop();
      this.logger.log(`Stopped container: ${containerId}`);
    } catch (err) {
      this.logger.warn(`Failed to stop container ${containerId}: ${err}`);
    }
  }

  async stopAndRemoveContainer(containerId: string) {
    if (!containerId) return;
    if (containerId.startsWith("mock-")) return;

    try {
      const container = this.docker.getContainer(containerId);
      let info: any | null = null;
      try {
        info = await container.inspect();
      } catch {
        // Not found already removed
      }

      const exitCode = typeof info?.State?.ExitCode === "number" ? info.State.ExitCode : null;
      const oomKilled = !!info?.State?.OOMKilled;
      const stateStatus = typeof info?.State?.Status === "string" ? info.State.Status : null;

      const running = !!info?.State?.Running;
      if (running) {
        try {
          const stopTimeoutSeconds = Math.max(5, Number(process.env.CS2_STOP_TIMEOUT_SECONDS ?? 15));
          // Give the server a moment to shut down cleanly.
          await container.stop({ t: stopTimeoutSeconds });
        } catch (err) {
          this.logger.warn(`Failed to stop container ${containerId}: ${err}`);
        }
      }

      // Capture a small tail of logs for non-zero exits (e.g. Exited (139)) before removal.
      // This keeps post-mortem context without retaining containers.
      if (!running && (exitCode !== null && exitCode !== 0 || oomKilled)) {
        const tail = await this.getContainerTailLogs(container, { tail: 220, maxBytes: 32_000 });
        const meta = [
          stateStatus ? `status=${stateStatus}` : null,
          exitCode !== null ? `exit=${exitCode}` : null,
          oomKilled ? "oomKilled=true" : null
        ]
          .filter(Boolean)
          .join(" ");
        if (tail) {
          this.logger.warn(`CS2 container ${containerId} exited abnormally (${meta}). Tail logs:\n${tail}`);
        } else {
          this.logger.warn(`CS2 container ${containerId} exited abnormally (${meta}). (No logs captured)`);
        }
      }

      try {
        await container.remove({ force: true });
        this.logger.log(`Removed container: ${containerId}`);
      } catch (err) {
        this.logger.warn(`Failed to remove container ${containerId}: ${err}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to stop/remove container ${containerId}: ${err}`);
    }
  }

  private async getContainerTailLogs(
    container: Docker.Container,
    options?: { tail?: number; maxBytes?: number }
  ): Promise<string | null> {
    const tail = Math.max(1, Math.min(5000, options?.tail ?? 200));
    const maxBytes = Math.max(1024, Math.min(512_000, options?.maxBytes ?? 32_000));

    try {
      const raw: any = await container.logs({ stdout: true, stderr: true, follow: false, tail });
      const buf = await this.readLogPayload(raw, maxBytes);
      if (!buf?.length) return null;
      const text = this.demuxDockerLogs(buf).trim();
      return text.length ? text : null;
    } catch (err) {
      this.logger.debug(`Failed to capture container logs: ${err}`);
      return null;
    }
  }

  private async readLogPayload(raw: any, maxBytes: number): Promise<Buffer> {
    if (!raw) return Buffer.alloc(0);
    if (Buffer.isBuffer(raw)) return raw.length > maxBytes ? raw.subarray(raw.length - maxBytes) : raw;
    if (raw instanceof Uint8Array) {
      const buf = Buffer.from(raw);
      return buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf;
    }
    // Dockerode may return a stream.
    if (raw instanceof Readable || typeof raw.on === "function") {
      return new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = raw as Readable;

        const done = () => {
          try {
            stream.removeAllListeners();
          } catch {
            // ignore
          }
          const buf = Buffer.concat(chunks, size);
          resolve(buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf);
        };

        stream.on("data", (chunk: Buffer | string) => {
          const b = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          chunks.push(b);
          size += b.length;
          if (size >= maxBytes) {
            try {
              stream.destroy();
            } catch {
              // ignore
            }
          }
        });
        stream.on("end", done);
        stream.on("close", done);
        stream.on("error", done);
      });
    }
    return Buffer.alloc(0);
  }

  private demuxDockerLogs(buf: Buffer): string {
    // When TTY is disabled, Docker multiplexes stdout/stderr with an 8-byte header per frame.
    // If parsing fails, fall back to a naive utf8 decode.
    try {
      if (buf.length < 8) return buf.toString("utf8");
      const parts: Buffer[] = [];
      let offset = 0;
      while (offset + 8 <= buf.length) {
        const size = buf.readUInt32BE(offset + 4);
        const start = offset + 8;
        const end = start + size;
        if (end > buf.length) break;
        if (size > 0) parts.push(buf.subarray(start, end));
        offset = end;
      }
      if (!parts.length) return buf.toString("utf8");
      return Buffer.concat(parts).toString("utf8");
    } catch {
      return buf.toString("utf8");
    }
  }

  private isCs2MatchContainerName(names: string[] | undefined) {
    return (names ?? []).some((n) => n.startsWith("/cs2-match-"));
  }

  async listCs2MatchContainers(options?: { all?: boolean }) {
    const all = options?.all ?? true;
    const containers = await this.docker.listContainers({ all });
    return containers.filter((c) => this.isCs2MatchContainerName(c.Names));
  }

  async isContainerRunning(containerId: string): Promise<boolean | null> {
    if (!containerId) return null;
    if (containerId.startsWith("mock-")) return null;
    try {
      const info: any = await this.docker.getContainer(containerId).inspect();
      return !!info?.State?.Running;
    } catch {
      return null;
    }
  }

  async cleanupExitedCs2MatchContainers(options?: { olderThanMs?: number }) {
    const olderThanMs = Math.max(0, options?.olderThanMs ?? 60 * 60 * 1000);
    const cutoff = Date.now() - olderThanMs;
    const containers = await this.listCs2MatchContainers({ all: true });

    let removed = 0;
    for (const c of containers) {
      const createdMs = (c.Created ?? 0) * 1000;
      const isOldEnough = createdMs > 0 ? createdMs <= cutoff : true;
      const state = (c.State ?? "").toLowerCase();
      const isRunning = state === "running";
      const isStopped = !isRunning;

      if (!isStopped) continue;
      if (!isOldEnough) continue;

      try {
        await this.stopAndRemoveContainer(c.Id);
        removed += 1;
      } catch (err) {
        this.logger.warn(`Failed to cleanup container ${c.Id}: ${err}`);
      }
    }

    if (removed > 0) {
      this.logger.log(`Cleaned up ${removed} exited cs2-match containers`);
    }

    return { ok: true, removed };
  }

  async listActiveCs2Servers() {
    const containers = await this.docker.listContainers({ all: false });
    return containers.filter(c => c.Names.some(name => name.startsWith("/cs2-match-")));
  }
}
