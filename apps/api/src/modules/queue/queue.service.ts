import { Inject, Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../../drizzle/client";
import { queueTicket, user as userTable, party as partyTable, match as matchTable } from "../../drizzle/schema";
import * as os from 'os';
import { MatchService } from "../match/match.service";
import { MapsService } from "../maps/maps.service";
import { PartyService } from "../party/party.service";
import { assertUserNotBanned } from "../../utils/ban";
import { DockerService } from "../../docker/docker.service";
import { sampleCpuUsagePercent } from "../../utils/system-metrics";

type QueueMode = 'ONE_V_ONE' | 'TWO_V_TWO' | 'THREE_V_THREE';
type User = typeof userTable.$inferSelect;
type Ticket = typeof queueTicket.$inferSelect;

type ModeLabel = "1v1" | "2v2" | "3v3";

type ResourceSnapshot = {
  exceeded: boolean;
  critical: boolean;
  warning: boolean;
  cpuUsage: number;
  memoryUsage: number;
  portCapacity?: { range: string | null; total: number; used: number; free: number } | null;
};

const MODE_LABEL: Record<QueueMode, ModeLabel> = {
  'ONE_V_ONE': "1v1",
  'TWO_V_TWO': "2v2",
  'THREE_V_THREE': "3v3"
};

// Server resource thresholds - Updated to 95% for critical load
const CPU_THRESHOLD = Number(process.env.CPU_THRESHOLD ?? 95); // 95% CPU usage threshold
const MEMORY_THRESHOLD = Number(process.env.MEMORY_THRESHOLD ?? 95); // 95% memory usage threshold
const CPU_WARNING_THRESHOLD = Number(process.env.CPU_WARNING_THRESHOLD ?? 80); // 80% warning threshold
const MEMORY_WARNING_THRESHOLD = Number(process.env.MEMORY_WARNING_THRESHOLD ?? 80); // 80% warning threshold

const MODE_LOOKUP: Record<string, QueueMode> = {
  "1v1": 'ONE_V_ONE',
  "11": 'ONE_V_ONE',
  "onevone": 'ONE_V_ONE',
  "duel": 'ONE_V_ONE',
  "2v2": 'TWO_V_TWO',
  "22": 'TWO_V_TWO',
  "twovtwo": 'TWO_V_TWO',
  "core": 'TWO_V_TWO',
  "3v3": 'THREE_V_THREE',
  "33": 'THREE_V_THREE',
  "threevthree": 'THREE_V_THREE',
  "squad": 'THREE_V_THREE'
};

@Injectable()
export class QueueService {
  constructor(
    @Inject(MatchService) private readonly matchService: MatchService,
    @Inject(MapsService) private readonly mapsService: MapsService,
    @Inject(PartyService) private readonly partyService: PartyService,
    @Inject(DockerService) private readonly dockerService: DockerService
  ) {}

  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly resourceSnapshotTtlMs = 5_000;
  private readonly resourceSnapshotCache: {
    value: ResourceSnapshot | null;
    expiresAt: number;
    inFlight: Promise<ResourceSnapshot> | null;
  } = {
    value: null,
    expiresAt: 0,
    inFlight: null,
  };

  async summary(mode: string) {
    const queueMode = this.resolveMode(mode);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(queueTicket)
      .where(
        and(
          eq(queueTicket.mode, queueMode),
          eq(queueTicket.status, "ENQUEUED"),
          sql`${queueTicket.createdAt} > now() - interval '10 minutes'`
        )
      );

    const population = Number(countRow?.count ?? 0);

    return {
      mode: MODE_LABEL[queueMode],
      eta: this.estimateEta(queueMode, population),
      population
    };
  }

  async summaries() {
    const rows = await db
      .select({ mode: queueTicket.mode, count: sql<number>`count(*)` })
      .from(queueTicket)
      .where(
        and(
          eq(queueTicket.status, "ENQUEUED"),
          sql`${queueTicket.createdAt} > now() - interval '10 minutes'`
        )
      )
      .groupBy(queueTicket.mode);

    const counts: Record<QueueMode, number> = {
      ONE_V_ONE: 0,
      TWO_V_TWO: 0,
      THREE_V_THREE: 0
    };

    for (const row of rows) {
      const mode = row.mode as QueueMode;
      if (mode in counts) counts[mode] = Number(row.count ?? 0);
    }

    const one = counts.ONE_V_ONE;
    const two = counts.TWO_V_TWO;
    const three = counts.THREE_V_THREE;

    return {
      "1v1": { population: one, eta: this.estimateEta("ONE_V_ONE", one) },
      "2v2": { population: two, eta: this.estimateEta("TWO_V_TWO", two) },
      "3v3": { population: three, eta: this.estimateEta("THREE_V_THREE", three) }
    };
  }

  async leave(body: { userId: string }) {
    // Cancel all active tickets for the user
    const [user] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, body.userId));
    
    if (!user) {
      throw new NotFoundException(`User ${body.userId} not found`);
    }

    const result = await db
      .update(queueTicket)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(queueTicket.userId, user.id),
          inArray(queueTicket.status, ['ENQUEUED', 'MATCHED'])
        )
      )
      .returning();

    if (result.length) {
      await db
        .delete(queueTicket)
        .where(and(eq(queueTicket.userId, user.id), eq(queueTicket.status, 'CANCELLED')));
    }

    return {
      ok: true,
      cancelledTickets: result.map(t => t.id)
    };
  }

  async join(body: { mode: string; userId: string; region?: string; partyCode?: string }) {
    const queueMode = this.resolveMode(body.mode);
    const region = (body.region ?? "GLOBAL").toUpperCase();
    
    console.log(`[queue] join request: userId=${body.userId}, mode=${body.mode} -> ${queueMode}, region=${region}`);
    
    const [user] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, body.userId));
    if (!user) {
      throw new NotFoundException(`User ${body.userId} could not join the queue because they do not exist`);
    }
    await assertUserNotBanned(user);
    if (this.isGuestUser(user)) {
      throw new ForbiddenException("Guest accounts cannot join matchmaking. Please sign in with Steam.");
    }

    // Clean up stale tickets older than 10 minutes for this user
    const staleTickets = await db
      .update(queueTicket)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(queueTicket.userId, user.id),
          eq(queueTicket.status, 'ENQUEUED'),
          sql`${queueTicket.createdAt} <= now() - interval '10 minutes'`
        )
      )
      .returning();
    if (staleTickets.length) {
      await db.delete(queueTicket).where(inArray(queueTicket.id, staleTickets.map(t => t.id)));
      console.log(`[queue] cleaned ${staleTickets.length} stale tickets for user ${user.id}`);
    }

    // Check server resources before allowing new queue joins
    const resources = await this.getServerResourcesSnapshot();
    
    if (resources.critical) {
      const [{ count: activeMatches }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(matchTable)
        .where(inArray(matchTable.status, ['PENDING', 'IN_PROGRESS']));
      const activeMatchesCount = Number(activeMatches ?? 0);
      const estimatedWaitSeconds = Math.max(60, activeMatchesCount * 30);
      const cap = resources.portCapacity
        ? `, ports ${resources.portCapacity.free}/${resources.portCapacity.total} free (${resources.portCapacity.range ?? "range"})`
        : "";
      console.log(
        `[queue] CRITICAL: server resources critical (cpu=${resources.cpuUsage}%, mem=${resources.memoryUsage}%${cap}), rejecting queue join for user ${user.id}`
      );
      const portMsg =
        resources.portCapacity && resources.portCapacity.free <= 0
          ? "Server is at capacity (no available CS2 ports). Matchmaking queued. Please try again shortly."
          : null;
      return {
        ok: false,
        error: portMsg ?? "Server is at critical load. Matchmaking temporarily disabled. Please try again in a few minutes.",
        status: "critical",
        retryAfter: portMsg ? 60 : 300,
        activeMatches: activeMatchesCount,
        estimatedWaitSeconds,
        portCapacity: resources.portCapacity ?? null
      };
    }
    
    if (resources.warning) {
      console.log(`[queue] WARNING: server resources at high load (${resources.cpuUsage}% CPU, ${resources.memoryUsage}% Memory), queue join allowed but delayed for user ${user.id}`);
      // Add a small delay for warning state to slow down queue joins
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (body.partyCode) {
      return this.joinAsParty(body.userId, queueMode, region, body.partyCode);
    }

    // Solo flow
    const [existing] = await db
      .select()
      .from(queueTicket)
      .where(
        and(
          eq(queueTicket.userId, user.id),
          eq(queueTicket.mode, queueMode),
          eq(queueTicket.region, region),
          eq(queueTicket.status, 'ENQUEUED')
        )
      );
    if (existing) {
      console.log(`[queue] user ${user.id} already has ticket ${existing.id} for ${queueMode} in ${region}`);
      return {
        ok: true,
        ticket: existing.id,
        etaSeconds: this.estimateEta(queueMode),
        region: existing.region,
        existing: true
      };
    }

    // Cancel old pending tickets (different mode/region)
    const cancelled = await db
      .update(queueTicket)
      .set({ status: 'CANCELLED' })
      .where(and(eq(queueTicket.userId, user.id), eq(queueTicket.status, 'ENQUEUED')))
      .returning();
    console.log(`[queue] cancelled ${cancelled.length} old tickets for user ${user.id}`);

    const ticket = await this.insertTicket(user.id, queueMode, region, null);
    console.log(`[queue] created ticket: ${ticket.id} for user ${user.id} in region ${ticket.region}`);

    return {
      ok: true,
      ticket: ticket.id,
      etaSeconds: this.estimateEta(queueMode),
      region: ticket.region,
      existing: false,
      matchId: null,
      lobbyCode: null,
      warning: null
    };
  }

  private async joinAsParty(userId: string, mode: QueueMode, region: string, partyCode: string) {
    const partyInfo = await this.partyService.getPartyWithMembersByCode(partyCode);
    if (!partyInfo) {
      return { ok: false, error: "Party not found" };
    }
    const { party, members } = partyInfo;

    if (!members.find(m => m.userId === userId)) {
      return { ok: false, error: "You are not in this party" };
    }
    if (party.leaderUserId !== userId) {
      return { ok: false, error: "Party leader must start queue" };
    }

    const teamSize = this.teamSizeForMode(mode);
    if (members.length > teamSize) {
      return { ok: false, error: `Party size exceeds team size for this mode (${teamSize})` };
    }

    if (!members.every(m => m.ready)) {
      return { ok: false, error: "All party members must be ready" };
    }

    // If party has fixed mode/region, enforce it. Otherwise set it now.
    if (party.mode && party.mode !== mode) {
      return { ok: false, error: "Party mode does not match queue mode" };
    }
    if (party.region && party.region.toUpperCase() !== region.toUpperCase()) {
      return { ok: false, error: "Party region does not match queue region" };
    }
    if (!party.mode || !party.region) {
      await db
        .update(partyTable)
        .set({ mode, region })
        .where(eq(partyTable.id, party.id));
    }

    const memberIds = members.map(m => m.userId);

    // Check existing party tickets
    const existingTickets = await db
      .select()
      .from(queueTicket)
      .where(
        and(
          inArray(queueTicket.userId, memberIds),
          eq(queueTicket.mode, mode),
          eq(queueTicket.region, region),
          eq(queueTicket.status, 'ENQUEUED'),
          eq(queueTicket.partyId, party.id)
        )
      );

    if (existingTickets.length === memberIds.length) {
      return {
        ok: true,
        ticket: existingTickets[0].id,
        etaSeconds: this.estimateEta(mode),
        region,
        existing: true
      };
    }

    // Cancel old tickets for all party members
    await db
      .update(queueTicket)
      .set({ status: 'CANCELLED' })
      .where(and(inArray(queueTicket.userId, memberIds), eq(queueTicket.status, 'ENQUEUED')));

    // Insert new tickets for each party member
    let firstTicketId: string | null = null;
    for (const memberId of memberIds) {
      const t = await this.insertTicket(memberId, mode, region, party.id);
      if (!firstTicketId) firstTicketId = t.id;
    }

    return {
      ok: true,
      ticket: firstTicketId ?? memberIds[0],
      etaSeconds: this.estimateEta(mode),
      region,
      existing: false,
      matchId: null,
      lobbyCode: null,
      warning: null
    };
  }

  async runMatchmakingCycle(): Promise<number> {
    const resources = await this.getServerResourcesSnapshot();
    if (resources.critical) {
      return 0;
    }

    const rows = await db
      .select({
        mode: queueTicket.mode,
        region: queueTicket.region,
        count: sql<number>`count(*)`,
      })
      .from(queueTicket)
      .where(
        and(
          eq(queueTicket.status, "ENQUEUED"),
          sql`${queueTicket.createdAt} > now() - interval '10 minutes'`,
        ),
      )
      .groupBy(queueTicket.mode, queueTicket.region)
      .orderBy(sql`count(*) desc`);

    if (rows.length === 0) {
      return 0;
    }

    const perBucketLimitRaw = Number(process.env.QUEUE_MATCHMAKER_MATCHES_PER_BUCKET ?? 3);
    const perBucketLimit = Number.isFinite(perBucketLimitRaw) ? Math.max(1, Math.floor(perBucketLimitRaw)) : 3;

    let matchesCreated = 0;

    for (const row of rows) {
      const mode = row.mode as QueueMode;
      const region = String(row.region ?? "GLOBAL");

      for (let attempt = 0; attempt < perBucketLimit; attempt += 1) {
        const result = await this.tryMatch(mode, region);
        if (!result?.match) {
          break;
        }
        matchesCreated += 1;
      }
    }

    return matchesCreated;
  }

  private isGuestUser(user: User) {
    const handle = user.handle?.toLowerCase() ?? "";
    return handle === "guest" || handle.startsWith("guest_");
  }

  private async insertTicket(userId: string, mode: QueueMode, region: string, partyId: string | null) {
    const ticketId = crypto.randomUUID();
    return db
      .insert(queueTicket)
      .values({
        id: ticketId,
        userId,
        mode,
        region,
        status: 'ENQUEUED',
        partyId
      })
      .returning()
      .then(rows => rows[0]);
  }

  private teamSizeForMode(mode: QueueMode): number {
    switch (mode) {
      case 'ONE_V_ONE':
        return 1;
      case 'THREE_V_THREE':
        return 3;
      default:
        return 2;
    }
  }

  private requiredPlayers(mode: QueueMode): number {
    return this.teamSizeForMode(mode) * 2;
  }

  private async tryMatch(mode: QueueMode, region: string): Promise<{ match?: any; warning?: string } | null> {
    const teamSize = this.teamSizeForMode(mode);
    const needed = this.requiredPlayers(mode);
    const tickets = await db
      .select()
      .from(queueTicket)
      .where(
        and(
          eq(queueTicket.mode, mode),
          eq(queueTicket.region, region),
          eq(queueTicket.status, 'ENQUEUED'),
          sql`${queueTicket.createdAt} > now() - interval '10 minutes'`
        )
      )
      .orderBy(sql`${queueTicket.createdAt} ASC`)
      .limit(30);

    if (tickets.length < needed) {
      return null;
    }

    const groups = this.buildTicketGroups(tickets)
      .filter(g => g.size <= teamSize)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const assignment = this.assignGroupsToTeams(groups, teamSize);
    if (!assignment) {
      return null;
    }

    const selectedTickets = assignment.teamA.concat(assignment.teamB).flatMap(g => g.tickets);
    if (selectedTickets.length < needed) {
      return null;
    }

    const modeLabel = MODE_LABEL[mode];
    const mapConfig = this.mapsService.selectMapForMatch(modeLabel);
    const ticketIds = selectedTickets.map(t => t.id);

    try {
      // Optimistically lock tickets by marking as MATCHED (avoid duplicate matches)
      const locked = await db
        .update(queueTicket)
        .set({ status: 'MATCHED' })
        .where(and(inArray(queueTicket.id, ticketIds), eq(queueTicket.status, 'ENQUEUED')))
        .returning();

      if (locked.length < ticketIds.length) {
        // Not enough tickets were locked (race). Revert and exit.
        if (locked.length > 0) {
          await db
            .update(queueTicket)
            .set({ status: 'ENQUEUED' })
            .where(inArray(queueTicket.id, locked.map(t => t.id)));
        }
        this.scheduleRetry(mode, region, 'lock-race');
        return { warning: 'Matchmaking delayed. Retrying automatically...' };
      }

      const alphaUserIds = assignment.teamA.flatMap(g => g.tickets.map(t => t.userId));
      const bravoUserIds = assignment.teamB.flatMap(g => g.tickets.map(t => t.userId));
      const result = await this.matchService.createMatchFromQueue({
        mode: modeLabel,
        region,
        map: mapConfig.id,
        alphaUserIds,
        bravoUserIds
      });

      console.log(`[queue] matched ${ticketIds.length} tickets for ${modeLabel} in ${region}`);
      this.resetRetry(mode, region);
      return result;
    } catch (err) {
      console.error('[queue] Failed to create match from tickets:', err);
      // Revert tickets to ENQUEUED so they can be retried
      await db
        .update(queueTicket)
        .set({ status: 'ENQUEUED' })
        .where(inArray(queueTicket.id, ticketIds));
      this.scheduleRetry(mode, region, 'match-create-failed');
      return { warning: 'Matchmaking delayed. Retrying automatically...' };
    }
  }

  private buildTicketGroups(tickets: Ticket[]) {
    const groups = new Map<string, { key: string; partyId: string | null; tickets: Ticket[]; size: number; createdAt: Date }>();

    for (const ticket of tickets) {
      const groupKey = ticket.partyId ?? `solo:${ticket.id}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.tickets.push(ticket);
        existing.size = existing.tickets.length;
        if (ticket.createdAt && new Date(ticket.createdAt) < new Date(existing.createdAt)) {
          existing.createdAt = ticket.createdAt as any;
        }
      } else {
        groups.set(groupKey, {
          key: groupKey,
          partyId: ticket.partyId ?? null,
          tickets: [ticket],
          size: 1,
          createdAt: ticket.createdAt as any
        });
      }
    }

    return Array.from(groups.values());
  }

  private assignGroupsToTeams(groups: { tickets: Ticket[]; size: number }[], teamSize: number) {
    const teamA: { tickets: Ticket[]; size: number }[] = [];
    const teamB: { tickets: Ticket[]; size: number }[] = [];
    const memo = new Set<string>();

    const dfs = (index: number, remA: number, remB: number): boolean => {
      if (remA === 0 && remB === 0) return true;
      if (index >= groups.length) return false;
      const key = `${index}|${remA}|${remB}`;
      if (memo.has(key)) return false;

      const g = groups[index];
      if (g.size <= remA) {
        teamA.push(g);
        if (dfs(index + 1, remA - g.size, remB)) return true;
        teamA.pop();
      }
      if (g.size <= remB) {
        teamB.push(g);
        if (dfs(index + 1, remA, remB - g.size)) return true;
        teamB.pop();
      }
      if (dfs(index + 1, remA, remB)) return true;

      memo.add(key);
      return false;
    };

    const ok = dfs(0, teamSize, teamSize);
    if (!ok) return null;
    return { teamA, teamB };
  }

  private scheduleRetry(mode: QueueMode, region: string, reason: string) {
    const key = `${mode}:${region}`;
    if (this.retryTimers.has(key)) return;

    const attempt = (this.retryAttempts.get(key) ?? 0) + 1;
    this.retryAttempts.set(key, attempt);

    const baseDelayMs = 5000;
    const maxDelayMs = 60000;
    const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
    const jitter = Math.floor(delay * 0.2 * (Math.random() * 2 - 1)); // +/-20%
    const finalDelay = Math.max(2000, delay + jitter);

    const timer = setTimeout(async () => {
      this.retryTimers.delete(key);
      try {
        await this.tryMatch(mode, region);
      } catch (err) {
        console.error('[queue] retry attempt failed:', err);
        this.scheduleRetry(mode, region, 'retry-failed');
      }
    }, finalDelay);

    this.retryTimers.set(key, timer);
    console.log(`[queue] retry scheduled in ${finalDelay}ms for ${mode} ${region} (attempt ${attempt}, reason=${reason})`);
  }

  private resetRetry(mode: QueueMode, region: string) {
    const key = `${mode}:${region}`;
    const timer = this.retryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(key);
    }
    this.retryAttempts.delete(key);
  }

  private async getServerResourcesSnapshot(): Promise<ResourceSnapshot> {
    const now = Date.now();
    if (this.resourceSnapshotCache.value && this.resourceSnapshotCache.expiresAt > now) {
      return this.resourceSnapshotCache.value;
    }

    if (this.resourceSnapshotCache.inFlight) {
      return this.resourceSnapshotCache.inFlight;
    }

    this.resourceSnapshotCache.inFlight = (async () => {
      try {
        const next = await this.measureServerResources();
        this.resourceSnapshotCache.value = next;
        this.resourceSnapshotCache.expiresAt = Date.now() + this.resourceSnapshotTtlMs;
        return next;
      } finally {
        this.resourceSnapshotCache.inFlight = null;
      }
    })();

    try {
      return await this.resourceSnapshotCache.inFlight;
    } catch (err) {
      if (this.resourceSnapshotCache.value) {
        return this.resourceSnapshotCache.value;
      }
      throw err;
    }
  }

  private async measureServerResources(): Promise<ResourceSnapshot> {
    try {
      // Sample CPU usage over a short interval (otherwise os.cpus() is cumulative since boot).
      const cpuUsagePercent = Math.round(await sampleCpuUsagePercent(120));
      
      // Get memory usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memUsagePercent = Math.floor(((totalMem - freeMem) / totalMem) * 100);

      const portCapacity = await this.dockerService.getPortCapacity().catch(() => null);
      const portCritical = !!(portCapacity && portCapacity.free <= 0);
      
      // Check critical thresholds (95%)
      const cpuCritical = cpuUsagePercent >= CPU_THRESHOLD;
      const memCritical = memUsagePercent >= MEMORY_THRESHOLD;
      const critical = cpuCritical || memCritical || portCritical;
      
      // Check warning thresholds (80%)
      const cpuWarning = cpuUsagePercent >= CPU_WARNING_THRESHOLD;
      const memWarning = memUsagePercent >= MEMORY_WARNING_THRESHOLD;
      const portWarning = !!(portCapacity && portCapacity.free <= 1);
      const warning = cpuWarning || memWarning || portWarning;
      
      // Exceeded if either critical or warning
      const exceeded = critical || warning;
      
      if (critical) {
        const cap = portCapacity ? `, Ports: ${portCapacity.free}/${portCapacity.total} free` : "";
        console.log(
          `[queue] CRITICAL: Server resources critical - CPU: ${cpuUsagePercent.toFixed(1)}% (threshold: ${CPU_THRESHOLD}%), Memory: ${memUsagePercent.toFixed(1)}% (threshold: ${MEMORY_THRESHOLD}%)${cap}`
        );
      } else if (warning) {
        const cap = portCapacity ? `, Ports: ${portCapacity.free}/${portCapacity.total} free` : "";
        console.log(
          `[queue] WARNING: Server resources high - CPU: ${cpuUsagePercent.toFixed(1)}% (warning: ${CPU_WARNING_THRESHOLD}%), Memory: ${memUsagePercent.toFixed(1)}% (warning: ${MEMORY_WARNING_THRESHOLD}%)${cap}`
        );
      }
      
      return { exceeded, critical, warning, cpuUsage: cpuUsagePercent, memoryUsage: memUsagePercent, portCapacity };
    } catch (err) {
      console.error('[queue] Failed to check server resources:', err);
      return { exceeded: false, critical: false, warning: false, cpuUsage: 0, memoryUsage: 0 };
    }
  }

  private resolveMode(mode: string): QueueMode {
    const normalized = mode.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const resolved = MODE_LOOKUP[normalized];
    if (!resolved) {
      throw new BadRequestException(`Unsupported queue mode: ${mode}`);
    }
    return resolved;
  }

  private estimateEta(mode: QueueMode, population = 0) {
    const base = mode === 'ONE_V_ONE' ? 25 : mode === 'THREE_V_THREE' ? 70 : 40;
    return Math.max(15, base - Math.min(population, 200) / 5);
  }

  private hoursAgo(hours: number) {
    const date = new Date();
    date.setHours(date.getHours() - hours);
    return date;
  }
}
