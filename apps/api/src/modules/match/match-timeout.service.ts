import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { DockerService } from "../../docker/docker.service";
import { db } from "../../drizzle/client";
import { match as matchTable, matchParticipant, queueTicket } from "../../drizzle/schema";

@Injectable()
export class MatchTimeoutService implements OnModuleInit {
  private readonly logger = new Logger(MatchTimeoutService.name);

  constructor(@Inject(DockerService) private readonly dockerService: DockerService) {}

  onModuleInit(): void {
    const enabled = (process.env.MATCH_TIMEOUT_ENABLED ?? "true").toLowerCase() === "true";
    if (!enabled) return;

    const intervalMs = Number(process.env.MATCH_TIMEOUT_INTERVAL_MS ?? 60_000);
    const effectiveInterval = Number.isFinite(intervalMs) ? Math.max(30_000, intervalMs) : 60_000;

    const run = async () => {
      try {
        // 1) Original check: PENDING matches where no one connected
        const noConnectMinutes = Number(process.env.MATCH_NO_CONNECT_TIMEOUT_MINUTES ?? 15);
        await this.finishNoConnectMatches({ timeoutMinutes: noConnectMinutes });

        // 2) New check: IN_PROGRESS matches where no one connected during warmup
        const warmupMinutes = Number(process.env.MATCH_WARMUP_TIMEOUT_MINUTES ?? 5);
        await this.finishWarmupNoShowMatches({ timeoutMinutes: warmupMinutes });

        // 3) New check: IN_PROGRESS matches running too long (stale server)
        const staleMinutes = Number(process.env.MATCH_STALE_TIMEOUT_MINUTES ?? 90);
        await this.finishStaleMatches({ timeoutMinutes: staleMinutes });
      } catch (err) {
        this.logger.warn(`Timeout loop failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    void run();
    const timer = setInterval(run, effectiveInterval);
    timer.unref();
  }

  /**
   * Original: cancel PENDING matches with serverStatus READY where no player connected.
   */
  private async finishNoConnectMatches(options: { timeoutMinutes: number }) {
    const timeoutMinutes = Number.isFinite(options.timeoutMinutes) ? Math.max(3, options.timeoutMinutes) : 15;
    const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);

    const candidates = await db
      .select({
        id: matchTable.id,
        containerId: matchTable.containerId,
        serverStatus: matchTable.serverStatus,
        createdAt: matchTable.createdAt
      })
      .from(matchTable)
      .where(and(eq(matchTable.status, "PENDING"), eq(matchTable.serverStatus, "READY"), lt(matchTable.createdAt, cutoff)))
      .orderBy(matchTable.createdAt)
      .limit(50);

    if (!candidates.length) return;

    for (const m of candidates) {
      await this.cancelMatchIfNoPlayers(m.id, m.containerId, `No players connected within ${timeoutMinutes} minutes (PENDING)`);
    }
  }

  /**
   * New: cancel IN_PROGRESS matches older than warmup timeout where NO player ever connected.
   * This catches the main bug: startServerForMatch() immediately sets status to IN_PROGRESS,
   * but if no player joins during warmup the match sits open forever.
   */
  private async finishWarmupNoShowMatches(options: { timeoutMinutes: number }) {
    const timeoutMinutes = Number.isFinite(options.timeoutMinutes) ? Math.max(2, options.timeoutMinutes) : 5;
    const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);

    const candidates = await db
      .select({
        id: matchTable.id,
        containerId: matchTable.containerId,
        createdAt: matchTable.createdAt
      })
      .from(matchTable)
      .where(
        and(
          eq(matchTable.status, "IN_PROGRESS"),
          lt(matchTable.createdAt, cutoff),
          // Only matches that haven't progressed past warmup (no rounds played, no score)
          sql`${matchTable.currentRound} = 0`,
          sql`${matchTable.scoreAlpha} = 0`,
          sql`${matchTable.scoreBravo} = 0`
        )
      )
      .orderBy(matchTable.createdAt)
      .limit(50);

    if (!candidates.length) return;

    for (const m of candidates) {
      await this.cancelMatchIfNoPlayers(m.id, m.containerId, `No players connected during warmup (${timeoutMinutes} min timeout)`);
    }
  }

  /**
   * New: force-finish IN_PROGRESS matches that have been running far too long.
   * Even if players did connect, a match running 90+ minutes is almost certainly stale.
   */
  private async finishStaleMatches(options: { timeoutMinutes: number }) {
    const timeoutMinutes = Number.isFinite(options.timeoutMinutes) ? Math.max(30, options.timeoutMinutes) : 90;
    const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);

    const candidates = await db
      .select({
        id: matchTable.id,
        containerId: matchTable.containerId,
        createdAt: matchTable.createdAt
      })
      .from(matchTable)
      .where(and(eq(matchTable.status, "IN_PROGRESS"), lt(matchTable.createdAt, cutoff)))
      .orderBy(matchTable.createdAt)
      .limit(50);

    if (!candidates.length) return;

    for (const m of candidates) {
      this.logger.warn(`Force-finishing stale match ${m.id} (running > ${timeoutMinutes} min)`);
      await this.finishAndCleanup(m.id, m.containerId, `Match exceeded ${timeoutMinutes} minute limit`);
    }
  }

  /**
   * Check if any participant connected; if not, cancel the match.
   */
  private async cancelMatchIfNoPlayers(matchId: string, containerId: string | null, reason: string) {
    const participants = await db
      .select({ userId: matchParticipant.userId, connected: matchParticipant.connected })
      .from(matchParticipant)
      .where(eq(matchParticipant.matchId, matchId));

    const anyConnected = participants.some((p) => !!p.connected);
    if (anyConnected) return;

    this.logger.warn(`Cancelling match ${matchId}: ${reason}`);
    await this.finishAndCleanup(matchId, containerId, reason);
  }

  /**
   * Mark match as FINISHED / DRAW, clean up queue tickets, stop container.
   */
  private async finishAndCleanup(matchId: string, containerId: string | null, reason: string) {
    const updated = await db
      .update(matchTable)
      .set({
        status: "FINISHED",
        winner: "DRAW",
        serverError: `UNRATED:${reason}`,
        containerId: null,
        serverEndpoint: null
      })
      .where(and(eq(matchTable.id, matchId), sql`${matchTable.status} != 'FINISHED'`))
      .returning({ id: matchTable.id });

    if (updated.length === 0) return;

    // Allow users to re-queue
    const participants = await db
      .select({ userId: matchParticipant.userId })
      .from(matchParticipant)
      .where(eq(matchParticipant.matchId, matchId));

    const userIds = participants.map((p) => p.userId).filter(Boolean);
    if (userIds.length > 0) {
      await db
        .delete(queueTicket)
        .where(and(inArray(queueTicket.userId, userIds), eq(queueTicket.status, "MATCHED")));
    }

    // Stop/remove Docker container
    const cid = (containerId ?? "").trim();
    if (cid) {
      try {
        await this.dockerService.stopAndRemoveContainer(cid);
      } catch (err) {
        this.logger.warn(`Failed to remove container for match ${matchId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

