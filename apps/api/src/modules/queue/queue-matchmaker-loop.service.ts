import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { QueueService } from "./queue.service";

@Injectable()
export class QueueMatchmakerLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMatchmakerLoopService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(@Inject(QueueService) private readonly queueService: QueueService) {}

  onModuleInit(): void {
    const matchmakingEnabled = (process.env.MATCHMAKER_ENABLED ?? "true").toLowerCase() === "true";
    const loopEnabled = (process.env.QUEUE_MATCHMAKER_LOOP_ENABLED ?? "true").toLowerCase() === "true";
    if (!matchmakingEnabled || !loopEnabled) {
      return;
    }

    const intervalRaw = Number(process.env.QUEUE_MATCHMAKER_LOOP_INTERVAL_MS ?? 2_000);
    const intervalMs = Number.isFinite(intervalRaw) ? Math.max(500, Math.floor(intervalRaw)) : 2_000;

    void this.runTick();
    this.timer = setInterval(() => {
      void this.runTick();
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`Queue matchmaking loop started (interval=${intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runTick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const matches = await this.queueService.runMatchmakingCycle();
      if (matches > 0) {
        this.logger.log(`Queue matchmaking loop created ${matches} match(es)`);
      }
    } catch (err) {
      this.logger.warn(`Queue matchmaking loop tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
