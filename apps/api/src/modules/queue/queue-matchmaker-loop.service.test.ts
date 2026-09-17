import { describe, expect, it, vi } from "vitest";

vi.mock("./queue.service", () => ({
  QueueService: class QueueService {},
}));

describe("QueueMatchmakerLoopService", () => {
  it("invokes queue cycle on tick", async () => {
    const { QueueMatchmakerLoopService } = await import("./queue-matchmaker-loop.service");
    const queueService = {
      runMatchmakingCycle: vi.fn().mockResolvedValue(2),
    };

    const worker = new QueueMatchmakerLoopService(queueService as any);
    await worker.runTick();

    expect(queueService.runMatchmakingCycle).toHaveBeenCalledTimes(1);
  });

  it("skips overlapping ticks", async () => {
    const { QueueMatchmakerLoopService } = await import("./queue-matchmaker-loop.service");
    let release!: () => void;
    const pending = new Promise<number>((resolve) => {
      release = () => resolve(0);
    });
    const queueService = {
      runMatchmakingCycle: vi.fn().mockImplementation(() => pending),
    };

    const worker = new QueueMatchmakerLoopService(queueService as any);
    const first = worker.runTick();
    const second = worker.runTick();

    expect(queueService.runMatchmakingCycle).toHaveBeenCalledTimes(1);

    release();
    await first;
    await second;
  });
});
