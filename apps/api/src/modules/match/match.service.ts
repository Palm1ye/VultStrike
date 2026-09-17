import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { eq, or, inArray, and, sql, desc } from "drizzle-orm";
import { db } from "../../drizzle/client";
import { match as matchTable, matchParticipant, user as userTable, queueTicket, matchReport } from "../../drizzle/schema";
import { DockerService } from "../../docker/docker.service";
import { getMapById, getRandomMap } from "../../config/maps.config";

type ScoreboardSideEntry = {
  player: string;
  steamId?: string | null;
  mmr: number;
  level: number;
  connected: boolean;
  connectedAt?: string | null;
  kills: number;
  assists: number;
  deaths: number;
  rating: number;
  delta: number;
};

type MatchResultPayload = {
  matchId: string;
  score: [number, number];
  winner: string;
  rated?: boolean;
  endReason?: string | null;
};

type QueueMode = 'ONE_V_ONE' | 'TWO_V_TWO' | 'THREE_V_THREE';
type User = typeof userTable.$inferSelect;

@Injectable()
export class MatchService {
  constructor(
    @Inject(DockerService) private readonly dockerService: DockerService
  ) {}

  private normalizeSteamId(steamId?: string | null): string | null {
    if (!steamId) return null;
    const trimmed = steamId.trim();
    if (!/^\d+$/.test(trimmed)) return trimmed;
    // If it's an account id (short), convert to SteamID64.
    if (trimmed.length <= 10) {
      const accountId = Number(trimmed);
      if (Number.isFinite(accountId) && accountId > 0) {
        return String(76561197960265728 + accountId);
      }
    }
    return trimmed;
  }

  async createMatchInternal(payload: { lobbyId: string; mode: "1v1" | "2v2" | "3v3"; region: string; map: string; tickets: string[]; avgMmr: number }) {
    const mode = this.resolveMode(payload.mode);
    const tickets = await db
      .select()
      .from(queueTicket)
      .where(inArray(queueTicket.id, payload.tickets));
    
    if (tickets.length === 0) {
      throw new NotFoundException(`Tickets not found: ${payload.tickets.join(", ")}`);
    }
    
    const matchId = crypto.randomUUID();
    const [createdMatch] = await db
      .insert(matchTable)
      .values({
        id: matchId,
        mode,
        map: payload.map,
        lobbyCode: payload.lobbyId,
        status: 'PENDING'
      })
      .returning();
    
    const participants = tickets.map((ticket, index) => ({
      matchId,
      userId: ticket.userId,
      team: index % 2 === 0 ? 'ALPHA' : 'BRAVO'
    }));
    await db.insert(matchParticipant).values(participants);
    
    // Update tickets to MATCHED
    await db
      .update(queueTicket)
      .set({ status: 'MATCHED' })
      .where(inArray(queueTicket.id, payload.tickets));
    
    return createdMatch;
  }

  async quickstart(body?: { mode?: string; region?: string; map?: string; players?: string[] }) {
    let players = await this.resolvePlayers(body?.players ?? []);

    if (players.length === 0) {
      // For testing: use placeholder players if none provided
      // These won't be inserted, just used for match creation flow
      players = [];
    }

    const mode = this.resolveMode(body?.mode ?? '1v1');
    const mapId = body?.map ?? this.pickDefaultMap(mode);
    const mapConfig = getMapById(mapId) ?? getRandomMap('1v1');
    const map = mapConfig.id;
    const workshopId = mapConfig.workshopId || undefined;


    const matchId = crypto.randomUUID();
    const [createdMatch] = await db
      .insert(matchTable)
      .values({
        id: matchId,
        mode,
        map,
        lobbyCode: this.randomLobby(),
        status: "PENDING"
      })
      .returning();
    const match = createdMatch;

    if (players.length > 0) {
      await this.createParticipants(match.id, players);
    }

    let containerId: string;
    let endpoint: string;
    try {
      const res = await this.startServerForMatch(match.id, map, workshopId, body?.region ?? "GLOBAL", match.lobbyCode!);
      containerId = res.containerId;
      endpoint = res.endpoint;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.markMatchProvisionFailed(match.id, errorMsg);
      // Quickstart is a testing/admin utility, so fail loudly but with a clear message.
      if (errorMsg.includes("No available CS2 ports")) {
        throw new ServiceUnavailableException("No available CS2 servers right now (at capacity). Try again shortly.");
      }
      throw err;
    }

    const updated = await this.findOne(match.id);
    return {
      match: updated,
      server: { containerId, endpoint }
    };
  }

  async createMatchFromQueue(payload: { mode: "1v1" | "2v2" | "3v3"; region: string; map: string; alphaUserIds: string[]; bravoUserIds: string[] }) {
    const mode = this.resolveMode(payload.mode);
    const mapId = payload.map;
    const mapConfig = getMapById(mapId) ?? getRandomMap(payload.mode);
    const map = mapConfig.id;
    const workshopId = mapConfig.workshopId || undefined;

    const matchId = crypto.randomUUID();
    const [createdMatch] = await db
      .insert(matchTable)
      .values({
        id: matchId,
        mode,
        map,
        lobbyCode: this.randomLobby(),
        status: "PENDING"
      })
      .returning();

    await this.createParticipantsWithTeams(matchId, payload.alphaUserIds, payload.bravoUserIds);

    let containerId: string;
    let endpoint: string;
    try {
      const res = await this.startServerForMatch(matchId, map, workshopId, payload.region, createdMatch.lobbyCode!);
      containerId = res.containerId;
      endpoint = res.endpoint;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.markMatchProvisionFailed(matchId, errorMsg);
      throw err;
    }

    const updated = await this.findOne(matchId);
    return {
      match: updated,
      server: { containerId, endpoint }
    };
  }

  async findOne(id: string) {
    // Fetch the match
    const [matchRow] = await db.select().from(matchTable).where(eq(matchTable.id, id));
    if (!matchRow) {
      throw new NotFoundException(`Match ${id} was not found`);
    }

    // Fetch participants with user info
    const participants = await db
      .select({
        id: matchParticipant.id,
        matchId: matchParticipant.matchId,
        userId: matchParticipant.userId,
        team: matchParticipant.team,
        side: matchParticipant.side,
        ready: matchParticipant.ready,
        connected: matchParticipant.connected,
        connectedAt: matchParticipant.connectedAt,
        createdAt: matchParticipant.createdAt,
        handle: userTable.handle,
        displayName: userTable.displayName,
        steamId: userTable.steamId,
        mmr1v1: userTable.mmr1v1,
        mmr2v2: userTable.mmr2v2,
        mmr3v3: userTable.mmr3v3,
        kills: matchParticipant.kills,
        assists: matchParticipant.assists,
        deaths: matchParticipant.deaths,
        rating: matchParticipant.rating
      })
      .from(matchParticipant)
      .leftJoin(userTable, eq(matchParticipant.userId, userTable.id))
      .where(eq(matchParticipant.matchId, id));

    // Build connect string from serverEndpoint if available
    const connect = matchRow.serverEndpoint ?? null;
    
    // Determine effective server status - if server endpoint exists, show as READY
    let effectiveServerStatus = matchRow.serverStatus ?? 'PENDING';
    if (effectiveServerStatus === 'PENDING' && matchRow.serverEndpoint) {
      effectiveServerStatus = 'READY';
    }
    
    // Use stored duration if available, otherwise calculate from creation time
    const durationSeconds = matchRow.durationSeconds && matchRow.durationSeconds > 0
      ? matchRow.durationSeconds
      : matchRow.createdAt
        ? Math.floor((Date.now() - new Date(matchRow.createdAt).getTime()) / 1000)
        : 0;
    const cancelReason =
      typeof matchRow.serverError === "string" && matchRow.serverError.startsWith("UNRATED:")
        ? matchRow.serverError.slice("UNRATED:".length)
        : null;
    
    return {
      id: matchRow.id,
      lobbyCode: matchRow.lobbyCode,
      map: matchRow.map,
      mode: this.presentMode(matchRow.mode),
      status: matchRow.status,
      serverStatus: effectiveServerStatus,
      serverError: matchRow.serverError ?? null,
      containerId: matchRow.containerId ?? null,
      serverEndpoint: matchRow.serverEndpoint,
      connect: connect,
      liveAt: matchRow.createdAt?.toISOString() ?? null,
      joinDeadlineAt: null,
      cancelReason,
      score: {
        alpha: matchRow.scoreAlpha ?? 0,
        bravo: matchRow.scoreBravo ?? 0,
        currentRound: matchRow.currentRound ?? 0
      },
      winner: matchRow.winner ?? null,
      durationSeconds,
      teams: this.partitionParticipants(matchRow.mode, participants as any)
    };
  }

  async listPlayers(id: string) {
    // Resolve match id by UUID or lobby code
    let matchId = id;
    const [matchById] = await db
      .select({ id: matchTable.id })
      .from(matchTable)
      .where(eq(matchTable.id, matchId));

    if (!matchById) {
      const [matchByLobby] = await db
        .select({ id: matchTable.id })
        .from(matchTable)
        .where(eq(matchTable.lobbyCode, matchId));
      if (matchByLobby) {
        matchId = matchByLobby.id;
      } else {
        throw new NotFoundException(`Match ${id} was not found`);
      }
    }

    const players = await db
      .select({
        steamId: userTable.steamId,
        handle: userTable.handle,
        displayName: userTable.displayName,
        team: matchParticipant.team
      })
      .from(matchParticipant)
      .leftJoin(userTable, eq(matchParticipant.userId, userTable.id))
      .where(eq(matchParticipant.matchId, matchId));

    return players.map((p) => ({
      steamId: p.steamId ?? null,
      handle: p.displayName && !p.displayName.startsWith('Steam ') ? p.displayName : p.handle,
      team: p.team ?? null
    }));
  }

  async recordResult(payload: MatchResultPayload) {
    try {
      // Resolve match by ID or lobbyCode
      let lookup = payload.matchId;

      let [matchRow] = await db
        .select({
          id: matchTable.id,
          containerId: matchTable.containerId,
          status: matchTable.status,
          currentRound: matchTable.currentRound
        })
        .from(matchTable)
        .where(eq(matchTable.id, lookup));

      if (!matchRow) {
        [matchRow] = await db
          .select({
            id: matchTable.id,
            containerId: matchTable.containerId,
            status: matchTable.status,
            currentRound: matchTable.currentRound
          })
          .from(matchTable)
          .where(eq(matchTable.lobbyCode, lookup));
      }

      if (!matchRow) {
        return { ok: false, error: "Match not found" };
      }

      const matchId = matchRow.id;
      const containerId = matchRow.containerId ?? null;
      const safeAlpha = Number.isFinite(payload.score[0]) ? Math.max(0, Math.floor(payload.score[0])) : 0;
      const safeBravo = Number.isFinite(payload.score[1]) ? Math.max(0, Math.floor(payload.score[1])) : 0;

      // Determine winner from score, warn if payload winner disagrees
      const computedWinner: 'ALPHA' | 'BRAVO' | 'DRAW' =
        safeAlpha > safeBravo
          ? 'ALPHA'
          : safeBravo > safeAlpha
          ? 'BRAVO'
          : 'DRAW';
      let winner: 'ALPHA' | 'BRAVO' | 'DRAW' = computedWinner;
      if (payload.winner && ['ALPHA', 'BRAVO', 'DRAW'].includes(payload.winner.toUpperCase())) {
        const normalized = payload.winner.toUpperCase() as 'ALPHA' | 'BRAVO' | 'DRAW';
        if (normalized !== computedWinner) {
          console.warn(
            `[match.service] Winner mismatch for match ${matchId}: payload=${normalized}, computed=${computedWinner} (score ${payload.score[0]}-${payload.score[1]})`
          );
        }
      }

      const normalizedEndReason = (payload.endReason ?? "").trim().toUpperCase();
      const inferredNoShow =
        winner === "DRAW" &&
        safeAlpha === 0 &&
        safeBravo === 0 &&
        (matchRow.currentRound ?? 0) === 0;
      const isRatedMatch = payload.rated === false || normalizedEndReason === "NO_SHOW" || inferredNoShow ? false : true;
      const unratedMarker = isRatedMatch ? null : `UNRATED:${normalizedEndReason || (inferredNoShow ? "NO_SHOW" : "MANUAL")}`;
      
      // Idempotency: only the first webhook should transition the match to FINISHED and apply MMR.
      const updated = await db
        .update(matchTable)
        .set({
          scoreAlpha: safeAlpha,
          scoreBravo: safeBravo,
          status: "FINISHED",
          winner: winner,
          containerId: null,
          ...(isRatedMatch
            ? {}
            : {
                serverStatus: "FAILED" as const,
                serverError: unratedMarker?.slice(0, 255) ?? "UNRATED"
              })
        })
        .where(and(eq(matchTable.id, matchId), sql`${matchTable.status} != 'FINISHED'`))
        .returning({ id: matchTable.id });

      if (updated.length === 0) {
        // Already processed by a previous webhook (or admin). Still try to cleanup the container.
        if (containerId) {
          setTimeout(() => void this.dockerService.stopAndRemoveContainer(containerId), 5000);
        }
        return { ok: true, alreadyFinished: true };
      }

      console.log(`[match.service] Match ${matchId} finished. Score: ${safeAlpha} - ${safeBravo}, Winner: ${winner}, Rated: ${isRatedMatch}`);

      if (isRatedMatch) {
        // Update MMR for all participants
        await this.updateMmrForMatch(matchId, winner);
      } else {
        console.log(`[match.service] Match ${matchId} marked as unrated (${unratedMarker ?? "UNRATED"}). Skipping MMR and rewards.`);
      }

      // Cleanup matched queue tickets for participants so users can re-queue immediately
      // and we don't retain stale MATCHED rows indefinitely.
      await this.cleanupMatchedTicketsForMatch(matchId);

      // Economy: grant credits once per rated finished match (behind env flag).
      if (isRatedMatch) {
        await this.grantCreditsForMatch(matchId, winner);
      }

      // Stop the Docker container after a short delay
      if (containerId) {
        setTimeout(async () => {
          try {
            await this.dockerService.stopAndRemoveContainer(containerId);
            console.log(`[match.service] Stopped/removed container ${containerId} for match ${matchId}`);
          } catch (error) {
            console.error(`[match.service] Failed to stop/remove container ${containerId}:`, error);
          }
        }, 5000); // Wait 5 seconds before stopping the container
      }

      return { ok: true, rated: isRatedMatch };
    } catch (error) {
      console.error('[match.service] Failed to record match result:', error);
      return { ok: false, error: String(error) };
    }
  }

  async updateScore(payload: { matchId: string; score: { alpha: number; bravo: number }; currentRound: number; durationSeconds: number }) {
    try {
      // Find match by ID or lobbyCode
      let matchId = payload.matchId;
      
      const [matchById] = await db
        .select({ id: matchTable.id })
        .from(matchTable)
        .where(eq(matchTable.id, matchId));
      
      if (!matchById) {
        const [matchByLobby] = await db
          .select({ id: matchTable.id })
          .from(matchTable)
          .where(eq(matchTable.lobbyCode, matchId));
        if (matchByLobby) {
          matchId = matchByLobby.id;
        } else {
          console.error(`[match.service] Match not found for score update: ${payload.matchId}`);
          return { ok: false, error: 'Match not found' };
        }
      }

      const [matchRow] = await db
        .select({
          status: matchTable.status,
          scoreAlpha: matchTable.scoreAlpha,
          scoreBravo: matchTable.scoreBravo,
          currentRound: matchTable.currentRound,
          durationSeconds: matchTable.durationSeconds
        })
        .from(matchTable)
        .where(eq(matchTable.id, matchId));

      if (!matchRow) {
        console.error(`[match.service] Match not found after resolve for score update: ${payload.matchId}`);
        return { ok: false, error: 'Match not found' };
      }

      // Ignore late/out-of-order updates once a match is finished.
      if (matchRow.status === 'FINISHED') {
        return { ok: true, ignored: true };
      }

      const incomingAlpha = Number.isFinite(payload.score.alpha) ? Math.max(0, Math.floor(payload.score.alpha)) : 0;
      const incomingBravo = Number.isFinite(payload.score.bravo) ? Math.max(0, Math.floor(payload.score.bravo)) : 0;
      const incomingRound = Number.isFinite(payload.currentRound) ? Math.max(0, Math.floor(payload.currentRound)) : 0;
      const incomingDuration = Number.isFinite(payload.durationSeconds) ? Math.max(0, Math.floor(payload.durationSeconds)) : 0;

      const currentAlpha = matchRow.scoreAlpha ?? 0;
      const currentBravo = matchRow.scoreBravo ?? 0;
      const currentRound = matchRow.currentRound ?? 0;
      const currentDuration = matchRow.durationSeconds ?? 0;

      // Prefer the newest snapshot (round first, then duration) so side-mapping
      // corrections can replace stale inverted scores.
      let shouldApply = false;
      if (incomingRound > currentRound) {
        shouldApply = true;
      } else if (incomingRound === currentRound) {
        if (incomingDuration > currentDuration) {
          shouldApply = true;
        } else if (incomingDuration === currentDuration) {
          const incomingTotal = incomingAlpha + incomingBravo;
          const currentTotal = currentAlpha + currentBravo;
          if (incomingTotal > currentTotal || incomingAlpha !== currentAlpha || incomingBravo !== currentBravo) {
            shouldApply = true;
          }
        }
      }

      if (!shouldApply) {
        return { ok: true, ignored: true };
      }

      const nextScoreAlpha = incomingAlpha;
      const nextScoreBravo = incomingBravo;
      const nextCurrentRound = Math.max(currentRound, incomingRound);
      const nextDurationSeconds = Math.max(currentDuration, incomingDuration);

      await db
        .update(matchTable)
        .set({
          scoreAlpha: nextScoreAlpha,
          scoreBravo: nextScoreBravo,
          currentRound: nextCurrentRound,
          durationSeconds: nextDurationSeconds,
          status: sql`CASE WHEN ${matchTable.status} = 'PENDING' THEN 'IN_PROGRESS' ELSE ${matchTable.status} END`
        })
        .where(and(eq(matchTable.id, matchId), sql`${matchTable.status} != 'FINISHED'`));

      return { ok: true };
    } catch (error) {
      console.error('[match.service] Failed to update score:', error);
      return { ok: false, error: String(error) };
    }
  }

  async reportMatch(
    matchId: string,
    reporter: { userId: string; role?: string },
    payload: { reason: string; details?: string; reportedHandle?: string; reportedUserId?: string }
  ) {
    const [matchRow] = await db.select({ id: matchTable.id }).from(matchTable).where(eq(matchTable.id, matchId));
    if (!matchRow) throw new NotFoundException("Match not found");

    if (reporter.role !== "ADMIN") {
      const [participant] = await db
        .select({ id: matchParticipant.id })
        .from(matchParticipant)
        .where(and(eq(matchParticipant.matchId, matchId), eq(matchParticipant.userId, reporter.userId)));
      if (!participant) {
        throw new BadRequestException("Only match participants can report.");
      }
    }

    const [existing] = await db
      .select({ id: matchReport.id })
      .from(matchReport)
      .where(and(eq(matchReport.matchId, matchId), eq(matchReport.reporterUserId, reporter.userId)));
    if (existing) {
      return { ok: true, duplicate: true, reportId: existing.id };
    }

    const allowedReasons = new Set(["CHEATING", "ABUSE", "GRIEFING", "AFK", "BUG", "OTHER"]);
    const reasonRaw = (payload.reason ?? "OTHER").trim().toUpperCase();
    const reason = allowedReasons.has(reasonRaw) ? reasonRaw : "OTHER";

    const details = payload.details?.trim();
    const safeDetails = details ? details.slice(0, 1024) : null;
    const reportedHandle = payload.reportedHandle?.trim().slice(0, 64) || null;
    const reportedUserId = payload.reportedUserId?.trim().slice(0, 36) || null;

    const [created] = await db
      .insert(matchReport)
      .values({
        matchId,
        reporterUserId: reporter.userId,
        reportedUserId,
        reportedHandle,
        reason,
        details: safeDetails
      })
      .returning();

    return { ok: true, reportId: created?.id ?? null };
  }

  async listReports(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 200);
    const rows = await db
      .select({
        id: matchReport.id,
        matchId: matchReport.matchId,
        reason: matchReport.reason,
        details: matchReport.details,
        reportedHandle: matchReport.reportedHandle,
        reportedUserId: matchReport.reportedUserId,
        createdAt: matchReport.createdAt,
        reporterId: userTable.id,
        reporterHandle: userTable.handle,
        reporterDisplayName: userTable.displayName,
        matchMap: matchTable.map,
        matchMode: matchTable.mode,
        matchStatus: matchTable.status,
        matchLobbyCode: matchTable.lobbyCode
      })
      .from(matchReport)
      .leftJoin(userTable, eq(matchReport.reporterUserId, userTable.id))
      .leftJoin(matchTable, eq(matchReport.matchId, matchTable.id))
      .orderBy(desc(matchReport.createdAt))
      .limit(capped);

    return rows.map((row) => ({
      id: row.id,
      matchId: row.matchId,
      reason: row.reason,
      details: row.details ?? null,
      reportedHandle: row.reportedHandle ?? null,
      reportedUserId: row.reportedUserId ?? null,
      createdAt: row.createdAt,
      reporter: {
        id: row.reporterId ?? "",
        handle: row.reporterHandle ?? "",
        displayName: row.reporterDisplayName ?? null
      },
      match: {
        id: row.matchId,
        map: row.matchMap ?? null,
        mode: row.matchMode ?? null,
        status: row.matchStatus ?? null,
        lobbyCode: row.matchLobbyCode ?? null
      }
    }));
  }

  private partitionParticipants(mode: QueueMode, participants: any[]) {
    return participants.reduce<{
      alpha: ScoreboardSideEntry[];
      bravo: ScoreboardSideEntry[];
    }>(
      (acc, entry) => {
        const team = typeof entry.team === "string" ? entry.team.toUpperCase() : "";
        const bucket =
          team === "ALPHA"
            ? acc.alpha
            : team === "BRAVO"
            ? acc.bravo
            : acc.alpha.length <= acc.bravo.length
            ? acc.alpha
            : acc.bravo;
        const mmr = this.mmrForMode(mode, entry as any);
        // Use displayName if available, otherwise fall back to handle
        const playerName = entry.displayName && !entry.displayName.startsWith('Steam ') 
          ? entry.displayName 
          : entry.handle;
        bucket.push({
          player: playerName,
          steamId: entry.steamId,
          mmr,
          level: this.mmrToLevel(mmr),
          connected: entry.connected ?? false,
          connectedAt: entry.connectedAt?.toISOString() ?? null,
          kills: entry.kills ?? 0,
          assists: entry.assists ?? 0,
          deaths: entry.deaths ?? 0,
          rating: entry.rating ?? 0,
          delta: 0
        });
        return acc;
      },
      { alpha: [], bravo: [] }
    );
  }

  private presentMode(mode: QueueMode) {
    switch (mode) {
      case 'ONE_V_ONE':
        return "1v1";
      case 'THREE_V_THREE':
        return "3v3";
      default:
        return "2v2";
    }
  }

  private resolveMode(mode: string): QueueMode {
    const normalized = mode.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["1v1", "11", "onevone", "duel"].includes(normalized)) return 'ONE_V_ONE';
    if (["3v3", "33", "threevthree", "squad"].includes(normalized)) return 'THREE_V_THREE';
    return 'TWO_V_TWO';
  }

  private async resolvePlayers(ids: string[]): Promise<User[]> {
    const sanitized = ids.map((id) => id.trim()).filter(Boolean);
    if (!sanitized.length) return [];
    let users: User[] = [];
    if (sanitized.length === 1) {
      users = await db
        .select()
        .from(userTable)
        .where(or(eq(userTable.id, sanitized[0]), eq(userTable.handle, sanitized[0])));
    } else {
      users = await db
        .select()
        .from(userTable)
        .where(or(inArray(userTable.id, sanitized), inArray(userTable.handle, sanitized)));
    }
    const foundIds = users.map(u => u.id).concat(users.map(u => u.handle));
    const missing = sanitized.filter(id => !foundIds.includes(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Players not found: ${missing.join(", ")}`);
    }
    return users;
  }

  private async createParticipants(matchId: string, users: User[]) {
    const entries = users.map((user, index) => ({
      matchId,
      userId: user.id,
      team: index % 2 === 0 ? 'ALPHA' : 'BRAVO'
    }));
    await db.insert(matchParticipant).values(entries);
  }

  private async createParticipantsWithTeams(matchId: string, alphaUserIds: string[], bravoUserIds: string[]) {
    const entries = [
      ...alphaUserIds.map((userId) => ({ matchId, userId, team: 'ALPHA' })),
      ...bravoUserIds.map((userId) => ({ matchId, userId, team: 'BRAVO' }))
    ];
    if (entries.length > 0) {
      await db.insert(matchParticipant).values(entries);
    }
  }

  private async startServerForMatch(matchId: string, map: string, workshopId: string | undefined, region: string, lobbyCode: string) {
    const port = await this.dockerService.allocatePort();
    const rosterConfig = await this.getRosterConfigForMatch(matchId);
    const extraEnv: Record<string, string> = {
      VS_EXPECTED_PLAYERS: String(rosterConfig.expectedPlayers)
    };
    if (rosterConfig.botConfig) {
      extraEnv.VS_ALLOW_BOTS = '1';
      extraEnv.VS_BOT_QUOTA = String(rosterConfig.botConfig.count);
      extraEnv.VS_BOT_TEAM = rosterConfig.botConfig.team;
    }

    const { containerId, endpoint } = await this.dockerService.startCs2Server({
      matchId,
      map,
      workshopId,
      port,
      lobbyCode,
      region,
      env: extraEnv
    });

    const connectString = `connect ${endpoint}`;
    await db.update(matchTable)
      .set({ 
        serverEndpoint: connectString,
        status: 'IN_PROGRESS'
      })
      .where(eq(matchTable.id, matchId));

    return { containerId, endpoint };
  }

  private async markMatchProvisionFailed(matchId: string, rawError: string) {
    const error = (rawError ?? "CS2 server provisioning failed").slice(0, 255);
    try {
      await db
        .update(matchTable)
        .set({
          status: "FINISHED",
          winner: "DRAW",
          serverStatus: "FAILED",
          serverError: error,
          containerId: null
        })
        .where(eq(matchTable.id, matchId));

      // If we already matched tickets, allow players to re-queue.
      await this.cleanupMatchedTicketsForMatch(matchId);
    } catch (e) {
      console.error(`[match.service] Failed to mark match ${matchId} as failed:`, e);
    }
  }

  private async cleanupMatchedTicketsForMatch(matchId: string) {
    try {
      const participants = await db
        .select({ userId: matchParticipant.userId })
        .from(matchParticipant)
        .where(eq(matchParticipant.matchId, matchId));

      const userIds = participants.map((p) => p.userId).filter(Boolean);
      if (userIds.length === 0) return;

      await db
        .delete(queueTicket)
        .where(and(inArray(queueTicket.userId, userIds), eq(queueTicket.status, "MATCHED")));
    } catch (err) {
      console.warn(`[match.service] Failed to cleanup matched tickets for match ${matchId}:`, err);
    }
  }

  private rewardsEnabled() {
    return (process.env.REWARDS_ENABLED ?? "false").toLowerCase() === "true";
  }

  private async grantCreditsForMatch(matchId: string, winner: "ALPHA" | "BRAVO" | "DRAW") {
    if (!this.rewardsEnabled()) return;

    const winCredits = Number(process.env.REWARDS_CREDITS_WIN ?? 100);
    const lossCredits = Number(process.env.REWARDS_CREDITS_LOSS ?? 40);
    const drawCredits = Number(process.env.REWARDS_CREDITS_DRAW ?? 70);

    const safeWin = Number.isFinite(winCredits) ? Math.max(0, Math.floor(winCredits)) : 100;
    const safeLoss = Number.isFinite(lossCredits) ? Math.max(0, Math.floor(lossCredits)) : 40;
    const safeDraw = Number.isFinite(drawCredits) ? Math.max(0, Math.floor(drawCredits)) : 70;

    try {
      const participants = await db
        .select({ userId: matchParticipant.userId, team: matchParticipant.team })
        .from(matchParticipant)
        .where(eq(matchParticipant.matchId, matchId));

      for (const p of participants) {
        const userId = p.userId;
        if (!userId) continue;
        const team = (p.team ?? "").toUpperCase();

        let delta = safeDraw;
        if (winner !== "DRAW") {
          delta = team === winner ? safeWin : safeLoss;
        }

        if (delta <= 0) continue;

        await db
          .update(userTable)
          .set({ credits: sql<number>`${userTable.credits} + ${delta}` })
          .where(eq(userTable.id, userId));
      }
    } catch (err) {
      console.warn(`[match.service] Failed to grant credits for match ${matchId}:`, err);
    }
  }

  private async getRosterConfigForMatch(matchId: string): Promise<{ expectedPlayers: number; botConfig: { count: number; team: 'CT' | 'T' } | null }> {
    const participants = await db
      .select({
        steamId: userTable.steamId,
        handle: userTable.handle,
        displayName: userTable.displayName,
        team: matchParticipant.team
      })
      .from(matchParticipant)
      .leftJoin(userTable, eq(matchParticipant.userId, userTable.id))
      .where(eq(matchParticipant.matchId, matchId));

    const humanCount = participants.filter((row) => Boolean((row.steamId ?? "").trim())).length;
    const expectedPlayers = humanCount > 0 ? humanCount : 2;

    const botRows = participants.filter((row) => {
      if (row.steamId) return false;
      const handle = (row.handle ?? "").toLowerCase();
      const display = (row.displayName ?? "").toLowerCase();
      return handle.includes('bot') || display.includes('bot');
    });

    if (botRows.length === 0) return { expectedPlayers, botConfig: null };
    const team = botRows[0].team === 'ALPHA' ? 'CT' : 'T';
    return { expectedPlayers, botConfig: { count: botRows.length, team } };
  }

  private pickDefaultMap(mode: QueueMode) {
    // Use configured workshop maps by default to avoid "map not found" fallbacks.
    if (mode === 'ONE_V_ONE') return "tirgo";
    if (mode === 'THREE_V_THREE') return "bluelines";
    return "aim_simplev2textured";
  }

  private randomLobby() {
    const num = Math.floor(Math.random() * 9000 + 1000);
    return `VS-${num}`;
  }

  // Handle player connect/disconnect events from CS2 server
  async recordPlayerEvent(payload: { matchId: string; steamId?: string; handle?: string; event: "connected" | "disconnected"; at?: number }) {
    try {
      // Find user by steamId
      if (!payload.steamId) {
        console.log(`[match.service] Player event without steamId: ${payload.handle}`);
        return { ok: false, error: 'No steamId provided' };
      }

      const normalizedSteamId = this.normalizeSteamId(payload.steamId);
      const [userRow] = await db
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.steamId, normalizedSteamId ?? payload.steamId));

      if (!userRow) {
        console.log(`[match.service] User not found for steamId: ${payload.steamId}`);
        return { ok: false, error: 'User not found' };
      }

      // Find the match - try by matchId first (which might be lobbyCode)
      let matchId = payload.matchId;
      
      // First try to find by ID
      let [matchRow] = await db
        .select({ id: matchTable.id })
        .from(matchTable)
        .where(eq(matchTable.id, matchId));
      
      // If not found, try by lobbyCode
      if (!matchRow) {
        const [matchByLobby] = await db
          .select({ id: matchTable.id })
          .from(matchTable)
          .where(eq(matchTable.lobbyCode, matchId));
        if (matchByLobby) {
          matchId = matchByLobby.id;
          matchRow = matchByLobby;
        }
      }

      if (!matchRow) {
        console.log(`[match.service] Match not found: ${payload.matchId}`);
        return { ok: false, error: 'Match not found' };
      }

      // Update participant connected status
      await db
        .update(matchParticipant)
        .set({
          connected: payload.event === 'connected',
          connectedAt: payload.event === 'connected' ? new Date() : undefined
        })
        .where(
          and(
            eq(matchParticipant.matchId, matchId),
            eq(matchParticipant.userId, userRow.id)
          )
        );

      console.log(`[match.service] Player ${payload.event}: ${payload.handle} (${payload.steamId}) in match ${matchId}`);
      return { ok: true };
    } catch (error) {
      console.error('[match.service] Failed to record player event:', error);
      return { ok: false, error: String(error) };
    }
  }

  // Update player stats from CS2 server
  async updatePlayerStats(payload: { matchId: string; players: { steamId: string; name: string; kills: number; deaths: number; assists: number; damage: number }[] }) {
    try {
      // Find match by ID or lobbyCode
      let matchId = payload.matchId;
      
      const [matchById] = await db
        .select({ id: matchTable.id })
        .from(matchTable)
        .where(eq(matchTable.id, matchId));
      
      if (!matchById) {
        const [matchByLobby] = await db
          .select({ id: matchTable.id })
          .from(matchTable)
          .where(eq(matchTable.lobbyCode, matchId));
        if (matchByLobby) {
          matchId = matchByLobby.id;
        } else {
          console.error(`[match.service] Match not found for stats update: ${payload.matchId}`);
          return { ok: false, error: 'Match not found' };
        }
      }

      // Update stats for each player
      for (const playerStats of payload.players) {
        // Find user by steamId
        const normalizedSteamId = this.normalizeSteamId(playerStats.steamId);
        const [userRow] = await db
          .select({ id: userTable.id })
          .from(userTable)
          .where(eq(userTable.steamId, normalizedSteamId ?? playerStats.steamId));

        if (!userRow) {
          console.log(`[match.service] User not found for steamId: ${playerStats.steamId}`);
          continue;
        }

        // Update participant stats
        await db
          .update(matchParticipant)
          .set({
            kills: playerStats.kills,
            deaths: playerStats.deaths,
            assists: playerStats.assists,
            damage: playerStats.damage,
            rating: playerStats.kills > 0 ? Math.round((playerStats.kills / Math.max(playerStats.deaths, 1)) * 100) : 0
          })
          .where(
            and(
              eq(matchParticipant.matchId, matchId),
              eq(matchParticipant.userId, userRow.id)
            )
          );

        console.log(`[match.service] Updated stats for player ${playerStats.name} (${playerStats.steamId}): K${playerStats.kills}/D${playerStats.deaths}/A${playerStats.assists}`);
      }

      return { ok: true, updated: payload.players.length };
    } catch (error) {
      console.error('[match.service] Failed to update player stats:', error);
      return { ok: false, error: String(error) };
    }
  }

  // Add missing mmrForMode helper
  private mmrForMode(mode: QueueMode, user: any): number {
    switch (mode) {
      case 'ONE_V_ONE':
        return user.mmr1v1 ?? 0;
      case 'THREE_V_THREE':
        return user.mmr3v3 ?? 0;
      default:
        return user.mmr2v2 ?? 0;
    }
  }

  // Add missing mmrToLevel helper (simple example)
  private mmrToLevel(mmr: number): number {
    if (mmr >= 3000) return 5;
    if (mmr >= 2500) return 4;
    if (mmr >= 2000) return 3;
    if (mmr >= 1500) return 2;
    return 1;
  }

  /**
   * Calculate and update MMR for all participants of a finished match
   */
  private async updateMmrForMatch(matchId: string, winner: 'ALPHA' | 'BRAVO' | 'DRAW') {
    try {
      // Get all participants with their current MMR
      const participants = await db
        .select({
          id: matchParticipant.id,
          userId: matchParticipant.userId,
          team: matchParticipant.team,
          mmr1v1: userTable.mmr1v1,
          mmr2v2: userTable.mmr2v2,
          mmr3v3: userTable.mmr3v3,
          placementMatches1v1: userTable.placementMatches1v1,
          placementMatches2v2: userTable.placementMatches2v2,
          placementMatches3v3: userTable.placementMatches3v3,
          placementWins1v1: userTable.placementWins1v1,
          placementWins2v2: userTable.placementWins2v2,
          placementWins3v3: userTable.placementWins3v3
        })
        .from(matchParticipant)
        .leftJoin(userTable, eq(matchParticipant.userId, userTable.id))
        .where(eq(matchParticipant.matchId, matchId));

      if (participants.length === 0) {
        console.log(`[match.service] No participants found for match ${matchId}`);
        return;
      }

      // Get match mode
      const [matchRow] = await db
        .select({ mode: matchTable.mode })
        .from(matchTable)
        .where(eq(matchTable.id, matchId));

      const mode = matchRow?.mode ?? 'TWO_V_TWO';
      const mmrField = mode === 'ONE_V_ONE' ? 'mmr1v1' : mode === 'THREE_V_THREE' ? 'mmr3v3' : 'mmr2v2';
      const placementField = mode === 'ONE_V_ONE' ? 'placementMatches1v1' : mode === 'THREE_V_THREE' ? 'placementMatches3v3' : 'placementMatches2v2';
      const placementWinsField = mode === 'ONE_V_ONE' ? 'placementWins1v1' : mode === 'THREE_V_THREE' ? 'placementWins3v3' : 'placementWins2v2';

      // Calculate and update MMR for each participant
      for (const participant of participants) {
        const currentMmr = (participant[mmrField as keyof typeof participant] as number | null) ?? 0;
        const placementMatches = (participant[placementField as keyof typeof participant] as number | null) ?? 0;
        const placementWins = (participant[placementWinsField as keyof typeof participant] as number | null) ?? 0;
        const isInPlacement = currentMmr === 0 && placementMatches < 5;
        
        if (isInPlacement) {
          // During placement - track wins and increment placement matches
          const didWin = winner !== 'DRAW' && participant.team === winner;
          const newPlacementCount = placementMatches + 1;
          const newPlacementWins = didWin ? placementWins + 1 : placementWins;
          
          if (newPlacementCount >= 5) {
            // Calculate final MMR based on actual wins during placement
            // Formula: 250 base + (matches * 50) + (wins * 100) - max bonus for winning all 5
            const baseMmr = 250; // Bronze start
            const matchesBonus = newPlacementCount * 50; // 250 for 5 matches
            const winsBonus = newPlacementWins * 100; // 0-500 based on wins
            const newMmr = Math.min(1500, baseMmr + matchesBonus + winsBonus);
            
            await db
              .update(userTable)
              .set({ 
                [mmrField]: newMmr,
                [placementField]: newPlacementCount,
                [placementWinsField]: newPlacementWins
              })
              .where(eq(userTable.id, participant.userId));
            
            console.log(`[match.service] User ${participant.userId} completed placement with MMR: ${newMmr} (${newPlacementWins}/5 wins)`);
          } else {
            // Increment placement matches and wins if applicable
            await db
              .update(userTable)
              .set({ 
                [placementField]: newPlacementCount,
                [placementWinsField]: newPlacementWins
              })
              .where(eq(userTable.id, participant.userId));
            
            console.log(`[match.service] User ${participant.userId} placement match ${newPlacementCount}/5 (${newPlacementWins} wins)`);
          }
        } else {
          // Normal MMR update for non-placement players
          let mmrChange = 0;

          if (winner === 'DRAW') {
            // Draw: small MMR change
            mmrChange = 5;
          } else {
            const didWin = participant.team === winner;
            
            if (didWin) {
              // Winner gets MMR based on their current MMR
              mmrChange = Math.max(10, Math.floor(25 - (currentMmr - 1000) / 100));
            } else {
              // Loser loses MMR based on their current MMR
              mmrChange = Math.min(-10, Math.floor(-25 - (currentMmr - 1000) / 100));
            }
          }

          const newMmr = Math.max(0, currentMmr + mmrChange);

          // Update the user's MMR
          await db
            .update(userTable)
            .set({ [mmrField]: newMmr })
            .where(eq(userTable.id, participant.userId));

          console.log(`[match.service] User ${participant.userId} MMR update: ${currentMmr} -> ${newMmr} (${mmrChange >= 0 ? '+' : ''}${mmrChange})`);
        }
      }

      console.log(`[match.service] MMR updated for ${participants.length} participants in match ${matchId}`);
    } catch (error) {
      console.error('[match.service] Failed to update MMR:', error);
    }
  }

  // Admin: List all open matches
  async listOpenMatches() {
    const openMatches = await db
      .select({
        id: matchTable.id,
        lobbyCode: matchTable.lobbyCode,
        map: matchTable.map,
        mode: matchTable.mode,
        status: matchTable.status,
        scoreAlpha: matchTable.scoreAlpha,
        scoreBravo: matchTable.scoreBravo,
        currentRound: matchTable.currentRound,
        createdAt: matchTable.createdAt
      })
      .from(matchTable)
      .where(sql`${matchTable.status} != 'FINISHED'`)
      .orderBy(sql`${matchTable.createdAt} DESC`)
      .limit(50);

    return {
      count: openMatches.length,
      matches: openMatches
    };
  }

  // Admin: Finish a specific match
  async finishMatch(matchId: string, winner?: 'ALPHA' | 'BRAVO' | 'DRAW') {
    try {
      const [matchRow] = await db
        .select()
        .from(matchTable)
        .where(eq(matchTable.id, matchId));

      if (!matchRow) {
        return {
          ok: false,
          error: `Match ${matchId} not found`
        };
      }

      if (matchRow.status === 'FINISHED') {
        return {
          ok: false,
          error: `Match ${matchId} is already finished`
        };
      }

      // Determine winner if not provided
      let finalWinner = winner ?? 'DRAW';
      if (!winner && matchRow.scoreAlpha !== null && matchRow.scoreBravo !== null) {
        finalWinner = matchRow.scoreAlpha > matchRow.scoreBravo ? 'ALPHA' : 
                      matchRow.scoreBravo > matchRow.scoreAlpha ? 'BRAVO' : 'DRAW';
      }

      await db
        .update(matchTable)
        .set({
          status: 'FINISHED',
          winner: finalWinner,
          containerId: null
        })
        .where(eq(matchTable.id, matchId));

      console.log(`[match.service] Admin operation: finished match ${matchId} with winner ${finalWinner}`);

      await this.cleanupMatchedTicketsForMatch(matchId);

      // Stop the Docker container after a short delay
      const containerId = matchRow.containerId;
      if (containerId) {
        setTimeout(async () => {
          try {
            await this.dockerService.stopAndRemoveContainer(containerId);
            console.log(`[match.service] Stopped/removed container ${containerId} for match ${matchId}`);
          } catch (error) {
            console.error(`[match.service] Failed to stop/remove container ${containerId}:`, error);
          }
        }, 5000); // Wait 5 seconds before stopping the container
      }

      return {
        ok: true,
        message: `Match ${matchId} finished with winner: ${finalWinner}`,
        matchId,
        winner: finalWinner
      };
    } catch (error) {
      console.error('[match.service] Failed to finish match:', error);
      return {
        ok: false,
        error: String(error)
      };
    }
  }

  // Admin: Finish all open matches
  async finishAllMatches() {
    try {
      // Get all non-finished matches
      const openMatches = await db
        .select({ id: matchTable.id, containerId: matchTable.containerId })
        .from(matchTable)
        .where(sql`${matchTable.status} != 'FINISHED'`);

      if (openMatches.length === 0) {
        return {
          ok: true,
          message: 'No open matches to finish',
          count: 0
        };
      }

      // Finish all matches
      await db
        .update(matchTable)
        .set({
          status: 'FINISHED',
          winner: 'DRAW',
          containerId: null
        })
        .where(sql`${matchTable.status} != 'FINISHED'`);

      console.log(`[match.service] Admin operation: finished ${openMatches.length} matches`);

      for (const match of openMatches) {
        await this.cleanupMatchedTicketsForMatch(match.id);
      }

      // Stop all Docker containers after a short delay
      for (const match of openMatches) {
        if (match.containerId) {
          setTimeout(async () => {
            try {
              await this.dockerService.stopAndRemoveContainer(match.containerId!);
              console.log(`[match.service] Stopped/removed container ${match.containerId} for match ${match.id}`);
            } catch (error) {
              console.error(`[match.service] Failed to stop/remove container ${match.containerId}:`, error);
            }
          }, 5000);
        }
      }

      return {
        ok: true,
        message: `Finished ${openMatches.length} matches`,
        count: openMatches.length
      };
    } catch (error) {
      console.error('[match.service] Failed to finish all matches:', error);
      return {
        ok: false,
        error: String(error)
      };
    }
  }

}
