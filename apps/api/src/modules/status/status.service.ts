import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import * as os from "os";
import { DockerService } from "../../docker/docker.service";
import { db } from "../../drizzle/client";
import { match as matchTable, queueTicket, user as userTable } from "../../drizzle/schema";
import { sampleCpuUsagePercent } from "../../utils/system-metrics";
import { Cs2UpdateService } from "./cs2-update.service";

type PublicStatusPayload = {
  ok: boolean;
  timestamp: string;
  uptimeSeconds: number;
  startedAt: number;
  services: {
    api: { status: string; detail: string };
    database: { status: string; detail: string };
    matchmaker: { status: string; detail: string };
  };
};

type ControlRoomPayload = {
  activeServers: number;
  queuedPlayers: number;
  activeMatches: number;
  avgSpinUpSeconds: number;
  utilization: number;
  portCapacity: Awaited<ReturnType<DockerService["getPortCapacity"]>> | null;
  servers: Array<{
    region: string;
    label: string;
    status: string;
    players: number;
    capacity: number;
    uptime: string;
  }>;
};

type ResourcesPayload = {
  cpu: {
    cores: number;
    usagePercent: number;
    loadAvg: {
      "1min": string;
      "5min": string;
      "15min": string;
    };
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  system: {
    platform: ReturnType<typeof os.platform>;
    arch: string;
    uptime: number;
  };
};

type PublicCs2CompatibilityPayload = {
  state: "compatible" | "outdated" | "checking" | "unknown";
  message: string;
};

type CacheSlot<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

const CS2_COMPATIBILITY_REFRESH_INTERVAL_MS = 2 * 60 * 60_000;

@Injectable()
export class StatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatusService.name);
  private readonly publicStatusTtlMs = 5_000;
  private readonly controlRoomTtlMs = 5_000;
  private readonly resourcesTtlMs = 5_000;
  private readonly cs2CompatibilityTtlMs = 10_000;
  private cs2CompatibilityRefreshTimer: ReturnType<typeof setInterval> | null = null;

  private readonly publicStatusCache: CacheSlot<PublicStatusPayload> = {
    value: null,
    expiresAt: 0,
    inFlight: null,
  };
  private readonly controlRoomCache: CacheSlot<ControlRoomPayload> = {
    value: null,
    expiresAt: 0,
    inFlight: null,
  };
  private readonly resourcesCache: CacheSlot<ResourcesPayload> = {
    value: null,
    expiresAt: 0,
    inFlight: null,
  };
  private readonly cs2CompatibilityCache: CacheSlot<PublicCs2CompatibilityPayload> = {
    value: null,
    expiresAt: 0,
    inFlight: null,
  };

  constructor(
    @Inject(DockerService) private readonly dockerService: DockerService,
    @Inject(Cs2UpdateService) private readonly cs2UpdateService: Cs2UpdateService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = (process.env.CS2_COMPATIBILITY_REFRESH_ENABLED ?? "true").toLowerCase() === "true";
    if (!enabled) {
      return;
    }

    try {
      await this.refreshPublicCs2Compatibility(true);
    } catch (err) {
      this.cs2CompatibilityCache.value = {
        state: "checking",
        message: "Checking server compatibility.",
      };
      this.logger.warn(`Initial CS2 compatibility refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.cs2CompatibilityRefreshTimer = setInterval(() => {
      void this.refreshPublicCs2Compatibility(true);
    }, CS2_COMPATIBILITY_REFRESH_INTERVAL_MS);
    this.cs2CompatibilityRefreshTimer.unref();

    this.logger.log("CS2 compatibility refresh loop started (interval=2h)");
  }

  onModuleDestroy(): void {
    if (this.cs2CompatibilityRefreshTimer) {
      clearInterval(this.cs2CompatibilityRefreshTimer);
      this.cs2CompatibilityRefreshTimer = null;
    }
  }

  async getPublicStatus(): Promise<PublicStatusPayload> {
    return this.readWithCache(this.publicStatusCache, this.publicStatusTtlMs, async () => {
      const startedAt = Date.now() - Math.round(process.uptime() * 1000);
      const dbOk = await this.checkDatabase();
      const matchmakerEnabled = (process.env.MATCHMAKER_ENABLED ?? "false").toLowerCase() === "true";

      return {
        ok: dbOk,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        startedAt,
        services: {
          api: {
            status: "optimal",
            detail: "API online",
          },
          database: {
            status: dbOk ? "optimal" : "scanning",
            detail: dbOk ? "PostgreSQL reachable" : "Database unavailable",
          },
          matchmaker: {
            status: matchmakerEnabled ? "deployed" : "scanning",
            detail: matchmakerEnabled ? "Matchmaker enabled" : "Matchmaker disabled",
          },
        },
      };
    });
  }

  async getControlRoom(): Promise<ControlRoomPayload> {
    return this.readWithCache(this.controlRoomCache, this.controlRoomTtlMs, async () => {
      const activeServers = await this.dockerService.listActiveCs2Servers();
      const activeServerCount = activeServers.length;
      const portCapacity = await this.dockerService.getPortCapacity().catch(() => null);

      const [{ count: queuedPlayers }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(queueTicket)
        .where(sql`${queueTicket.status} = 'ENQUEUED'`);

      const [{ count: activeMatches }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(matchTable)
        .where(sql`${matchTable.status} = 'IN_PROGRESS'`);

      const capacity = activeServerCount * 12;
      const utilization = capacity ? Math.round((Number(activeMatches) * 12 * 100) / capacity) : 0;

      const servers = activeServers.map((server, index) => ({
        region: "GLOBAL",
        label: `cs2-${index + 1}`,
        status: "Healthy",
        players: 0,
        capacity: 12,
        uptime: server.Status ?? "",
      }));

      return {
        activeServers: activeServerCount,
        queuedPlayers: Number(queuedPlayers ?? 0),
        activeMatches: Number(activeMatches ?? 0),
        avgSpinUpSeconds: 28,
        utilization,
        portCapacity,
        servers,
      };
    });
  }

  async getResources(): Promise<ResourcesPayload> {
    return this.readWithCache(this.resourcesCache, this.resourcesTtlMs, async () => {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memUsagePercent = Math.round((usedMem / totalMem) * 100);

      const cpuCount = os.cpus().length;
      const cpuUsagePercent = Math.round(await sampleCpuUsagePercent(120));
      const loadAvg = os.loadavg();

      return {
        cpu: {
          cores: cpuCount,
          usagePercent: cpuUsagePercent,
          loadAvg: {
            "1min": loadAvg[0].toFixed(2),
            "5min": loadAvg[1].toFixed(2),
            "15min": loadAvg[2].toFixed(2),
          },
        },
        memory: {
          total: Math.round(totalMem / 1024 / 1024 / 1024),
          used: Math.round(usedMem / 1024 / 1024 / 1024),
          free: Math.round(freeMem / 1024 / 1024 / 1024),
          usagePercent: memUsagePercent,
        },
        system: {
          platform: os.platform(),
          arch: os.arch(),
          uptime: Math.round(os.uptime() / 60),
        },
      };
    });
  }

  async getPublicCs2Compatibility(): Promise<PublicCs2CompatibilityPayload> {
    return this.cs2CompatibilityCache.value ?? {
      state: "checking",
      message: "Checking server compatibility.",
    };
  }

  async refreshPublicCs2Compatibility(forceRefresh = false): Promise<PublicCs2CompatibilityPayload> {
    const compat = await this.cs2UpdateService.getCompatibilityStatus(forceRefresh);
    const nextValue: PublicCs2CompatibilityPayload = {
      state: compat.state,
      message: compat.state === "compatible"
        ? "Server is up to date."
        : compat.state === "outdated"
          ? "Server update required."
          : "Checking server compatibility."
    };

    this.cs2CompatibilityCache.value = nextValue;
    this.cs2CompatibilityCache.expiresAt = Date.now() + this.cs2CompatibilityTtlMs;
    return nextValue;
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await db.select().from(userTable).limit(1);
      return true;
    } catch (err) {
      this.logger.warn(`Database health check failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async readWithCache<T>(
    slot: CacheSlot<T>,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    if (slot.value && slot.expiresAt > now) {
      return slot.value;
    }

    if (slot.inFlight) {
      return slot.inFlight;
    }

    slot.inFlight = (async () => {
      try {
        const nextValue = await loader();
        slot.value = nextValue;
        slot.expiresAt = Date.now() + ttlMs;
        return nextValue;
      } finally {
        slot.inFlight = null;
      }
    })();

    try {
      return await slot.inFlight;
    } catch (err) {
      if (slot.value) {
        this.logger.warn(`Serving stale status cache after refresh failure: ${err instanceof Error ? err.message : String(err)}`);
        return slot.value;
      }
      throw err;
    }
  }
}
