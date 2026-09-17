import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { lt, sql } from "drizzle-orm";
import { db } from "../../drizzle/client";
import { queueTicket } from "../../drizzle/schema";

@Injectable()
export class QueueTicketCleanupService implements OnModuleInit {
  private readonly logger = new Logger(QueueTicketCleanupService.name);

  onModuleInit(): void {
    const enabled = (process.env.QUEUE_TICKET_CLEANUP_ENABLED ?? "true").toLowerCase() === "true";
    if (!enabled) return;

    const intervalMs = Number(process.env.QUEUE_TICKET_CLEANUP_INTERVAL_MS ?? 10 * 60_000);
    const retentionMinutes = Number(process.env.QUEUE_TICKET_RETENTION_MINUTES ?? 180);
    const effectiveInterval = Number.isFinite(intervalMs) ? Math.max(60_000, intervalMs) : 10 * 60_000;

    const run = async () => {
      try {
        await this.cleanup({ retentionMinutes });
      } catch (err) {
        this.logger.warn(`Queue ticket cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    void run();
    const timer = setInterval(run, effectiveInterval);
    timer.unref();
  }

  private async cleanup(options: { retentionMinutes: number }) {
    const retentionMinutes = Number.isFinite(options.retentionMinutes) ? Math.max(30, options.retentionMinutes) : 180;
    const cutoff = new Date(Date.now() - retentionMinutes * 60_000);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(queueTicket)
      .where(lt(queueTicket.createdAt, cutoff));

    const total = Number(count ?? 0);
    if (total <= 0) return;

    await db.delete(queueTicket).where(lt(queueTicket.createdAt, cutoff));
    this.logger.log(`Deleted ${total} queue tickets older than ${retentionMinutes} minutes`);
  }
}

