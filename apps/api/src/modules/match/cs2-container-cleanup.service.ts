import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DockerService } from "../../docker/docker.service";
import { db } from "../../drizzle/client";
import { match as matchTable, matchParticipant, queueTicket } from "../../drizzle/schema";

type MatchRow = {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "FINISHED";
  serverStatus: string | null;
  containerId: string | null;
  createdAt: Date | null;
};

@Injectable()
export class Cs2ContainerCleanupService implements OnModuleInit {
  private readonly logger = new Logger(Cs2ContainerCleanupService.name);

  constructor(@Inject(DockerService) private readonly dockerService: DockerService) {}

  onModuleInit(): void {
    const enabled = (process.env.CS2_CONTAINER_CLEANUP_ENABLED ?? "true").toLowerCase() === "true";
    if (!enabled) return;

    const intervalMs = Number(process.env.CS2_CONTAINER_CLEANUP_INTERVAL_MS ?? 10 * 60 * 1000);
    const retentionMinutes = Number(process.env.CS2_CONTAINER_RETENTION_MINUTES ?? 60);
    const startupGraceSeconds = Number(process.env.CS2_CONTAINER_STARTUP_GRACE_SECONDS ?? 120);

    const run = async () => {
      try {
        // 1) Remove exited cs2-match containers that are older than retention.
        await this.dockerService.cleanupExitedCs2MatchContainers({
          olderThanMs: Math.max(1, retentionMinutes) * 60 * 1000
        });

        // 2) If a match is still open but its container is gone or stopped, mark it as failed/finished (no MMR applied).
        await this.failMatchesWithDeadContainers({ startupGraceSeconds });
      } catch (err) {
        this.logger.warn(`Cleanup loop failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    void run();
    const timer = setInterval(run, Math.max(30_000, intervalMs));
    // Do not keep the Node event loop alive for a best-effort cleanup task.
    timer.unref();
  }

  private async failMatchesWithDeadContainers(options: { startupGraceSeconds: number }) {
    const startupGraceSeconds = Math.max(30, options.startupGraceSeconds);

    const open = await db
      .select({
        id: matchTable.id,
        status: matchTable.status,
        serverStatus: matchTable.serverStatus,
        containerId: matchTable.containerId,
        createdAt: matchTable.createdAt
      })
      .from(matchTable)
      .where(
        and(
          inArray(matchTable.status, ["PENDING", "IN_PROGRESS"]),
          sql`${matchTable.containerId} is not null`
        )
      )
      .limit(50);

    if (!open.length) return;

    for (const m of open as MatchRow[]) {
      const containerId = (m.containerId ?? "").trim();
      if (!containerId) continue;
      if (containerId.startsWith("mock-")) continue;

      // Don't be too aggressive right after match creation.
      const createdAtMs = m.createdAt ? new Date(m.createdAt).getTime() : 0;
      const ageSeconds = createdAtMs > 0 ? (Date.now() - createdAtMs) / 1000 : Number.POSITIVE_INFINITY;
      if (ageSeconds < startupGraceSeconds && (m.serverStatus ?? "").toUpperCase() === "STARTING") {
        continue;
      }

      const running = await this.dockerService.isContainerRunning(containerId);
      const dead = running === null || running === false;

      if (!dead) continue;

      this.logger.warn(`Match ${m.id} has a dead/missing container (${containerId}). Marking as FINISHED (DRAW) without MMR.`);

      await db
        .update(matchTable)
        .set({
          status: "FINISHED",
          winner: "DRAW",
          serverStatus: "FAILED",
          serverError: "CS2 server exited unexpectedly",
          containerId: null
        })
        .where(and(eq(matchTable.id, m.id), sql`${matchTable.status} != 'FINISHED'`));

      // Allow users to re-queue by cleaning up MATCHED tickets.
      try {
        const participants = await db
          .select({ userId: matchParticipant.userId })
          .from(matchParticipant)
          .where(eq(matchParticipant.matchId, m.id));
        const userIds = participants.map((p) => p.userId).filter(Boolean);
        if (userIds.length > 0) {
          await db
            .delete(queueTicket)
            .where(and(inArray(queueTicket.userId, userIds), eq(queueTicket.status, "MATCHED")));
        }
      } catch (err) {
        this.logger.warn(`Failed to cleanup MATCHED tickets for match ${m.id}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Best effort cleanup.
      await this.dockerService.stopAndRemoveContainer(containerId);
    }
  }
}
