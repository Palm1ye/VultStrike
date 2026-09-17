import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import Docker from "dockerode";
import { existsSync, readFileSync } from "fs";
import { promisify } from "util";

// These are host paths — the API container has the Docker socket mounted,
// so it can spawn containers that bind-mount these host directories.
const HOST_STEAMCMD_DIR = (process.env.CS2_STEAMCMD_DIR ?? "/home/steam/steamcmd").trim();
const HOST_STEAM_RUNTIME_DIR = (process.env.CS2_STEAM_RUNTIME_DIR ?? "/home/steam/Steam").trim();
const HOST_STEAM_DOT_DIR = (process.env.CS2_STEAM_DOT_DIR ?? "/home/steam/.steam").trim();
const DEFAULT_STEAM_LIBRARY_CS2_DIR = (process.env.CS2_STEAM_LIBRARY_CS2_DIR ?? "/home/steam/Steam/steamapps/common/Counter-Strike Global Offensive").trim();
const LEGACY_STEAM_LIBRARY_CS2_DIR = (process.env.CS2_LEGACY_STEAM_LIBRARY_CS2_DIR ?? "/home/steam/steam/steamapps/common/Counter-Strike Global Offensive").trim();
const LEGACY_CS2_DIR = (process.env.CS2_LEGACY_HOST_DIR ?? "/home/steam/cs2").trim();
const CONTAINER_CS2_DIR = "/home/steam/cs2-dedicated";
const CONTAINER_STEAM_LIBRARY_DIR = "/home/steam/Steam";

const UPDATE_CONTAINER_NAME = "vultstrike-cs2-updater";
const MAX_OUTPUT_BYTES = 256_000;
const BUILD_CHECK_TTL_MS = 5 * 60 * 1000;

// Use the same base image as the CS2 server — it already has lib32gcc-s1 etc.
const UPDATE_IMAGE = "vultstrike-cs2:latest";
const execFileAsync = promisify(execFile);

function stripAnsi(value: string): string {
  return value.split("\u001B").join("").replace(/\[[0-9;]*m/g, "");
}

type CompatibilityState = "compatible" | "outdated" | "checking" | "unknown";

export type Cs2CompatibilityStatus = {
  installedBuildId: string | null;
  latestBuildId: string | null;
  compatible: boolean | null;
  state: CompatibilityState;
  checkedAt: string | null;
  message: string;
};

export type UpdateStatus = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  success: boolean | null;
  output: string | null;
  buildId: string | null;
  installedBuildId: string | null;
  hostCs2Dir: string;
  steamLibraryDir: string | null;
  progressPercent: number | null;
  step: string;
  latestBuildId: string | null;
  compatibleWithLatest: boolean | null;
  compatibilityState: CompatibilityState;
  compatibilityCheckedAt: string | null;
  errorSummary: string | null;
};

@Injectable()
export class Cs2UpdateService {
  private readonly logger = new Logger(Cs2UpdateService.name);
  private readonly docker = new Docker();
  private readonly hostCs2Dir = this.resolveHostCs2Dir();
  private readonly steamLibraryDir = this.resolveHostSteamLibraryDir(this.hostCs2Dir);
  private readonly updateImage = (process.env.CS2_IMAGE ?? UPDATE_IMAGE).trim() || UPDATE_IMAGE;

  constructor() {
    this.warnIfHostPathsLookMisconfigured();
  }

  private running = false;
  private startedAt: Date | null = null;
  private finishedAt: Date | null = null;
  private success: boolean | null = null;
  private output: string | null = null;
  private latestBuildId: string | null = null;
  private latestBuildCheckedAt: Date | null = null;
  private latestBuildLookupPromise: Promise<void> | null = null;
  private latestBuildLookupError: string | null = null;
  private installedBuildId: string | null = null;
  private installedBuildCheckedAt: Date | null = null;
  private installedBuildLookupPromise: Promise<void> | null = null;

  async getStatus(forceRefresh = false): Promise<UpdateStatus> {
    const compatibility = await this.getCompatibilityStatus(forceRefresh);
    const cleanedOutput = this.output ? stripAnsi(this.output).trim() : null;
    return {
      running: this.running,
      startedAt: this.startedAt?.toISOString() ?? null,
      finishedAt: this.finishedAt?.toISOString() ?? null,
      success: this.success,
      output: cleanedOutput,
      buildId: this.parseBuildId(cleanedOutput),
      installedBuildId: compatibility.installedBuildId,
      hostCs2Dir: this.hostCs2Dir,
      steamLibraryDir: this.steamLibraryDir,
      progressPercent: this.parseProgressPercent(cleanedOutput),
      step: this.describeStep(cleanedOutput),
      latestBuildId: compatibility.latestBuildId,
      compatibleWithLatest: compatibility.compatible,
      compatibilityState: compatibility.state,
      compatibilityCheckedAt: compatibility.checkedAt,
      errorSummary: this.success === false ? this.extractFailureSummary(cleanedOutput) : null,
    };
  }

  async getCompatibilityStatus(forceRefresh = false): Promise<Cs2CompatibilityStatus> {
    await this.refreshInstalledBuildIdIfNeeded(forceRefresh);
    await this.refreshLatestBuildIdIfNeeded(forceRefresh);

    const installedBuildId = this.installedBuildId;
    const latestBuildId = this.latestBuildId;
    const compatible = installedBuildId && latestBuildId ? installedBuildId === latestBuildId : null;

    if (compatible === true) {
      return {
        installedBuildId,
        latestBuildId,
        compatible,
        state: "compatible",
        checkedAt: this.latestBuildCheckedAt?.toISOString() ?? null,
        message: "Installed CS2 build is compatible with the latest public build.",
      };
    }

    if (compatible === false) {
      return {
        installedBuildId,
        latestBuildId,
        compatible,
        state: "outdated",
        checkedAt: this.latestBuildCheckedAt?.toISOString() ?? null,
        message: "Installed CS2 build is behind the latest public build.",
      };
    }

    if (this.latestBuildLookupPromise) {
      return {
        installedBuildId,
        latestBuildId,
        compatible,
        state: "checking",
        checkedAt: this.latestBuildCheckedAt?.toISOString() ?? null,
        message: "Checking latest CS2 build information.",
      };
    }

    return {
      installedBuildId,
      latestBuildId,
      compatible,
      state: "unknown",
      checkedAt: this.latestBuildCheckedAt?.toISOString() ?? null,
      message: this.latestBuildLookupError
        ? `Could not determine latest CS2 build: ${this.latestBuildLookupError}`
        : "Latest CS2 build information is unavailable.",
    };
  }

  /** Returns false if an update is already in progress. */
  startUpdate(): boolean {
    if (this.running) return false;

    this.running = true;
    this.startedAt = new Date();
    this.finishedAt = null;
    this.success = null;
    this.output = [
      `Resolved host CS2 dir: ${this.hostCs2Dir}`,
      `Resolved Steam library dir: ${this.steamLibraryDir ?? "unknown"}`,
      `Using updater image: ${this.updateImage}`,
      "Preparing update container...",
    ].join("\n");

    this.runUpdate().catch((err) => {
      this.output = `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
      this.success = false;
      this.finishedAt = new Date();
      this.running = false;
      this.logger.error(`CS2 update unexpected error: ${err}`);
    });

    return true;
  }

  private warnIfHostPathsLookMisconfigured(): void {
    const missingPaths: string[] = [];
    if (!existsSync(this.hostCs2Dir)) missingPaths.push(`CS2 host dir (${this.hostCs2Dir})`);
    if (!existsSync(HOST_STEAMCMD_DIR)) missingPaths.push(`steamcmd dir (${HOST_STEAMCMD_DIR})`);
    if (!existsSync(`${HOST_STEAMCMD_DIR}/steamcmd.sh`)) missingPaths.push(`steamcmd executable (${HOST_STEAMCMD_DIR}/steamcmd.sh)`);
    if (!existsSync(HOST_STEAM_DOT_DIR)) missingPaths.push(`steam dot dir (${HOST_STEAM_DOT_DIR})`);

    if (missingPaths.length > 0) {
      this.logger.warn(
        `CS2 updater path check: missing ${missingPaths.join(", ")}. `
        + "Set CS2_HOST_DIR / CS2_STEAMCMD_DIR / CS2_STEAM_RUNTIME_DIR / CS2_STEAM_DOT_DIR correctly for this host.",
      );
    }

    if (!existsSync(HOST_STEAM_RUNTIME_DIR)) {
      this.logger.warn(`CS2 updater path check: steam runtime dir not found (${HOST_STEAM_RUNTIME_DIR}); docker fallback build checks may be limited.`);
    }
  }

  private async runUpdate(): Promise<void> {
    // Remove any leftover updater container from a previous run
    await this.removeContainerIfExists(UPDATE_CONTAINER_NAME);

    const containerInstallDir = this.resolveContainerInstallDir();

    const cmd = [
      "bash", "-lc",
      [
        "set -e",
        `mkdir -p '${containerInstallDir}'`,
        `if [ -L '${containerInstallDir}/steamapps' ]; then rm -f '${containerInstallDir}/steamapps'; fi`,
        `mkdir -p '${containerInstallDir}/steamapps'`,
        "/home/steam/steamcmd/steamcmd.sh +login anonymous +quit",
        `/home/steam/steamcmd/steamcmd.sh +force_install_dir '${containerInstallDir}' +quit`,
        `/home/steam/steamcmd/steamcmd.sh +force_install_dir '${containerInstallDir}' +login anonymous +app_update 730 validate +quit`,
      ].join(" && "),
    ];

    await this.refreshInstalledBuildIdIfNeeded(true);
    const beforeInstalledBuildId = this.installedBuildId;
    let container: Docker.Container | null = null;
    let logPoll: ReturnType<typeof setInterval> | null = null;
    try {
      container = await this.docker.createContainer({
        Image: this.updateImage,
        name: UPDATE_CONTAINER_NAME,
        Entrypoint: [""],
        Cmd: cmd,
        HostConfig: {
          Binds: this.resolveUpdateBinds(),
          AutoRemove: false,
        },
      });

      await container.start();
      const runningContainer = container;

      this.output = `${this.output ?? ""}\nUpdate container started. Waiting for steamcmd output...`.trim();
      logPoll = setInterval(() => {
        void this.refreshLiveLogs(runningContainer);
      }, 2000);

      // Wait for finish first, then collect final logs.
      // Collecting logs in parallel can return partial/empty output while the
      // container is still running.
      const exitCode = await this.waitForContainer(container);

      if (logPoll) {
        clearInterval(logPoll);
        logPoll = null;
      }

      const logs = await this.collectLogs(container);
      const cleanedLogs = stripAnsi(logs).trim();
      if (cleanedLogs.length > 0) {
        this.output = cleanedLogs;
      } else if (!this.output || this.output.trim().length === 0) {
        this.output = `Updater exited with code ${exitCode} but produced no logs.`;
      }

      await this.refreshInstalledBuildIdIfNeeded(true);
      await this.refreshLatestBuildIdIfNeeded(true);
      const afterInstalledBuildId = this.installedBuildId;
      const buildChanged = Boolean(beforeInstalledBuildId && afterInstalledBuildId && beforeInstalledBuildId !== afterInstalledBuildId);
      const alreadyCurrent = Boolean(this.latestBuildId && afterInstalledBuildId && this.latestBuildId === afterInstalledBuildId);
      const successMarker = /Success! App '730' fully installed|Success! App '730' already up to date|fully installed\./i.test(cleanedLogs);
      const failureSummary = this.extractFailureSummary(cleanedLogs);

      this.success = exitCode === 0 && (alreadyCurrent || buildChanged || successMarker || !failureSummary);

      if (this.success && failureSummary) {
        this.logger.warn(`Ignoring stale CS2 updater error summary after successful completion: ${failureSummary}`);
      }

      if (this.success) {
        this.logger.log("CS2 update finished successfully");
      } else {
        this.logger.warn(`CS2 update finished with exit code ${exitCode}`);
      }
    } finally {
      if (logPoll) {
        clearInterval(logPoll);
      }
      if (container) {
        try {
          await container.remove({ force: true });
        } catch {
          // best effort
        }
      }
      this.finishedAt = new Date();
      this.running = false;
    }
  }

  private resolveHostCs2Dir(): string {
    const configured = (process.env.CS2_HOST_DIR ?? "").trim();
    if (configured) {
      return configured;
    }

    if (existsSync(`${DEFAULT_STEAM_LIBRARY_CS2_DIR}/game/bin/linuxsteamrt64/cs2`)) {
      return DEFAULT_STEAM_LIBRARY_CS2_DIR;
    }

    if (existsSync(`${LEGACY_STEAM_LIBRARY_CS2_DIR}/game/bin/linuxsteamrt64/cs2`)) {
      return LEGACY_STEAM_LIBRARY_CS2_DIR;
    }

    return LEGACY_CS2_DIR;
  }

  private resolveHostSteamLibraryDir(hostCs2Dir = this.hostCs2Dir): string | null {
    const commonSegment = "/steamapps/common/";
    const idx = hostCs2Dir.indexOf(commonSegment);
    if (idx >= 0) {
      return hostCs2Dir.slice(0, idx);
    }
    return null;
  }

  private resolveContainerInstallDir(): string {
    if (this.steamLibraryDir) {
      return `${CONTAINER_STEAM_LIBRARY_DIR}/steamapps/common/Counter-Strike Global Offensive`;
    }

    return CONTAINER_CS2_DIR;
  }

  private resolveUpdateBinds(): string[] {
    const binds = [
      `${HOST_STEAMCMD_DIR}:/home/steam/steamcmd`,
      `${HOST_STEAM_DOT_DIR}:/home/steam/.steam`,
    ];

    if (this.steamLibraryDir) {
      binds.push(`${this.steamLibraryDir}:${CONTAINER_STEAM_LIBRARY_DIR}`);
      return binds;
    }

    binds.push(`${this.hostCs2Dir}:${CONTAINER_CS2_DIR}`);

    if (existsSync(HOST_STEAM_RUNTIME_DIR)) {
      binds.push(`${HOST_STEAM_RUNTIME_DIR}:${CONTAINER_STEAM_LIBRARY_DIR}`);
    }

    return binds;
  }

  private async waitForContainer(container: Docker.Container): Promise<number> {
    const result = await container.wait();
    return typeof result?.StatusCode === "number" ? result.StatusCode : -1;
  }

  private async refreshLiveLogs(container: Docker.Container): Promise<void> {
    try {
      const logs = await this.collectLogs(container);
      const cleaned = stripAnsi(logs).trim();
      if (cleaned) {
        this.output = cleaned;
      }
    } catch {
      // best effort while update is in progress
    }
  }

  private async collectLogs(container: Docker.Container): Promise<string> {
    try {
      const raw: any = await container.logs({ stdout: true, stderr: true, follow: false });
      return this.demuxAndTrim(raw);
    } catch {
      return "";
    }
  }

  private demuxAndTrim(raw: any): string {
    if (!raw) return "";
    let buf: Buffer;
    if (Buffer.isBuffer(raw)) {
      buf = raw;
    } else if (raw instanceof Uint8Array) {
      buf = Buffer.from(raw);
    } else {
      return "";
    }
    if (buf.length > MAX_OUTPUT_BYTES) {
      buf = buf.subarray(buf.length - MAX_OUTPUT_BYTES);
    }
    // Docker multiplexes stdout/stderr with 8-byte frame headers when TTY is off
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
    return (parts.length ? Buffer.concat(parts) : buf).toString("utf8");
  }

  private async removeContainerIfExists(name: string): Promise<void> {
    try {
      await this.docker.getContainer(name).remove({ force: true });
    } catch {
      // doesn't exist, fine
    }
  }

  private parseBuildId(output: string | null): string | null {
    if (!output) return null;
    const match =
      output.match(/Build ID\s*[:-]\s*(\d+)/i) ??
      output.match(/buildid['":\s]+(\d+)/i);
    return match?.[1] ?? null;
  }

  private parseLatestBuildId(output: string | null): string | null {
    if (!output) return null;

    const publicBranchMatch = output.match(/"branches"\s*\{[\s\S]*?"public"\s*\{[\s\S]*?"buildid"\s*"(\d+)"/i);
    if (publicBranchMatch?.[1]) return publicBranchMatch[1];

    const buildMatches = [...output.matchAll(/"buildid"\s*"(\d+)"/gi)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value));

    if (buildMatches.length === 0) {
      return null;
    }

    return String(Math.max(...buildMatches));
  }

  private readLocalInstalledBuildId(): string | null {
    const candidates = this.getInstalledManifestCandidates();

    for (const manifestPath of candidates) {
      if (!existsSync(manifestPath)) continue;

      try {
        const text = readFileSync(manifestPath, "utf8");
        const match = text.match(/"buildid"\s+"(\d+)"/i);
        if (match?.[1]) {
          return match[1];
        }
      } catch {
        // try next candidate
      }
    }

    return null;
  }

  private getInstalledManifestCandidates(): string[] {
    const candidates: string[] = [];

    // Primary candidate for this updater flow: appmanifest under force_install_dir.
    candidates.push(`${this.hostCs2Dir}/steamapps/appmanifest_730.acf`);

    const steamLibraryDir = this.resolveHostSteamLibraryDir();
    if (steamLibraryDir) {
      candidates.push(`${steamLibraryDir}/steamapps/appmanifest_730.acf`);
    }

    return Array.from(new Set(candidates));
  }

  private async refreshInstalledBuildIdIfNeeded(force = false): Promise<void> {
    const recentlyChecked = this.installedBuildCheckedAt && (Date.now() - this.installedBuildCheckedAt.getTime()) < BUILD_CHECK_TTL_MS;
    if (!force && recentlyChecked) {
      return;
    }

    if (this.installedBuildLookupPromise) {
      await this.installedBuildLookupPromise;
      return;
    }

    this.installedBuildLookupPromise = this.fetchInstalledBuildId();
    try {
      await this.installedBuildLookupPromise;
    } finally {
      this.installedBuildLookupPromise = null;
    }
  }

  private async fetchInstalledBuildId(): Promise<void> {
    const localBuildId = this.readLocalInstalledBuildId();
    if (localBuildId) {
      this.installedBuildId = localBuildId;
      this.installedBuildCheckedAt = new Date();
      return;
    }

    const manifestCandidates = this.getInstalledManifestCandidates();
    if (manifestCandidates.length === 0) {
      this.installedBuildId = null;
      this.installedBuildCheckedAt = new Date();
      return;
    }

    let container: Docker.Container | null = null;
    try {
      container = await this.docker.createContainer({
        Image: this.updateImage,
        Entrypoint: [""],
        Cmd: [
          "bash",
          "-lc",
          "for p in /host-root/appmanifest_730.acf /host-steam/steamapps/appmanifest_730.acf; do if [ -f \"$p\" ]; then cat \"$p\"; break; fi; done",
        ],
        HostConfig: {
          Binds: [
            `${this.hostCs2Dir}/steamapps:/host-root`,
            ...(this.steamLibraryDir ? [`${this.steamLibraryDir}:/host-steam`] : []),
          ],
          AutoRemove: false,
        },
      });

      await container.start();
      await this.waitForContainer(container);
      const logs = await this.collectLogs(container);
      const match = logs.match(/"buildid"\s+"(\d+)"/i);
      this.installedBuildId = match?.[1] ?? null;
      this.installedBuildCheckedAt = new Date();
    } catch {
      this.installedBuildId = null;
      this.installedBuildCheckedAt = new Date();
    } finally {
      if (container) {
        try {
          await container.remove({ force: true });
        } catch {
          // best effort
        }
      }
    }
  }

  private parseProgressPercent(output: string | null): number | null {
    if (!output) return null;
    const matches = [...output.matchAll(/\[\s*(\d{1,3})%\]/g)];
    const last = matches.at(-1)?.[1];
    if (!last) return null;
    const value = Number(last);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  }

  private describeStep(output: string | null): string {
    if (!output) {
      return this.success === true
        ? "Completed"
        : this.success === false
          ? "Failed"
          : "Idle";
    }

    if (/Failed to install app/i.test(output) || /Disk write failure/i.test(output)) {
      return "Failed to install";
    }
    if (/starting commit/i.test(output) || /Committing/i.test(output)) {
      return "Committing files";
    }
    if (/Verifying/i.test(output)) {
      return "Verifying files";
    }
    if (/Downloading/i.test(output) || /Current download rate/i.test(output)) {
      return "Downloading update";
    }
    if (/Connecting anonymously to Steam Public/i.test(output)) {
      return "Connecting to Steam";
    }
    if (/Waiting for user info/i.test(output) || /Waiting for client config/i.test(output)) {
      return "Authorizing session";
    }
    if (/Update container started/i.test(output) || /Preparing update container/i.test(output)) {
      return "Starting updater";
    }
    if (/finished successfully/i.test(output) || /AppID 730 finished update/i.test(output)) {
      return "Completed";
    }

    return this.running ? "Running" : "Idle";
  }

  private extractFailureSummary(output: string | null): string | null {
    if (!output) return null;

    if (/Success! App '730' fully installed|Success! App '730' already up to date|AppID 730 finished update/i.test(output)) {
      return null;
    }

    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const patterns = [
      /disk write failure/i,
      /failed to install app/i,
      /not writable/i,
      /error!/i,
      /failed to update/i,
      /no subscription/i,
    ];

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]!;
      if (patterns.some((pattern) => pattern.test(line))) {
        return line;
      }
    }

    return null;
  }

  private async refreshLatestBuildIdIfNeeded(force = false): Promise<void> {
    const recentlyChecked = this.latestBuildCheckedAt && (Date.now() - this.latestBuildCheckedAt.getTime()) < BUILD_CHECK_TTL_MS;
    if (!force && recentlyChecked) {
      return;
    }

    if (this.latestBuildLookupPromise) {
      await this.latestBuildLookupPromise;
      return;
    }

    this.latestBuildLookupPromise = this.fetchLatestBuildId();

    try {
      await this.latestBuildLookupPromise;
    } finally {
      this.latestBuildLookupPromise = null;
    }
  }

  private async fetchLatestBuildId(): Promise<void> {
    let hostAttemptError: string | null = null;
    const hostSteamCmd = `${HOST_STEAMCMD_DIR}/steamcmd.sh`;
    if (existsSync(hostSteamCmd)) {
      try {
        const { stdout, stderr } = await execFileAsync(
          hostSteamCmd,
          ["+login", "anonymous", "+app_info_update", "1", "+app_info_print", "730", "+quit"],
          {
            maxBuffer: 8 * 1024 * 1024,
            timeout: 90_000,
          },
        );

        const cleanedLogs = stripAnsi(`${stdout ?? ""}\n${stderr ?? ""}`).trim();
        const latestBuildId = this.parseLatestBuildId(cleanedLogs);
        this.latestBuildId = latestBuildId;
        this.latestBuildLookupError = latestBuildId ? null : "build ID could not be parsed from steamcmd output";
        this.latestBuildCheckedAt = new Date();

        if (latestBuildId) {
          return;
        }
      } catch (error) {
        hostAttemptError = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Host steamcmd build lookup failed, falling back to Docker: ${hostAttemptError}`);
      }
    } else {
      hostAttemptError = `steamcmd not found at ${HOST_STEAMCMD_DIR}`;
    }

    let container: Docker.Container | null = null;
    try {
      container = await this.docker.createContainer({
        Image: this.updateImage,
        Entrypoint: [""],
        Cmd: [
          "bash",
          "-lc",
          "/home/steam/steamcmd/steamcmd.sh +login anonymous +app_info_update 1 +app_info_print 730 +quit",
        ],
        HostConfig: {
          Binds: [
            `${HOST_STEAMCMD_DIR}:/home/steam/steamcmd`,
            `${HOST_STEAM_RUNTIME_DIR}:/home/steam/Steam`,
          ],
          AutoRemove: false,
        },
      });

      await container.start();
      await this.waitForContainer(container);
      const logs = await this.collectLogs(container);
      const cleanedLogs = stripAnsi(logs).trim();
      const latestBuildId = this.parseLatestBuildId(cleanedLogs);

      this.latestBuildId = latestBuildId;
      this.latestBuildLookupError = latestBuildId
        ? null
        : hostAttemptError
          ? `${hostAttemptError}; build ID could not be parsed from docker steamcmd output`
          : "build ID could not be parsed from docker steamcmd output";
      this.latestBuildCheckedAt = new Date();
    } catch (error) {
      const dockerError = error instanceof Error ? error.message : String(error);
      this.latestBuildLookupError = hostAttemptError
        ? `${hostAttemptError}; docker fallback failed: ${dockerError}`
        : dockerError;
      this.latestBuildCheckedAt = new Date();
      this.logger.warn(`Failed to fetch latest CS2 build metadata: ${this.latestBuildLookupError}`);
    } finally {
      if (container) {
        try {
          await container.remove({ force: true });
        } catch {
          // best effort
        }
      }
    }
  }
}
