import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../drizzle/client", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../utils/system-metrics", () => ({
  sampleCpuUsagePercent: vi.fn().mockResolvedValue(42),
}));

describe("QueueService", () => {
  async function createService() {
    const { QueueService } = await import("./queue.service");
    const matchService = {};
    const mapsService = {};
    const partyService = {};
    const dockerService = {
      getPortCapacity: vi.fn().mockResolvedValue({ range: "20000-32767", total: 4, used: 1, free: 3 }),
    };
    const service = new QueueService(
      matchService as any,
      mapsService as any,
      partyService as any,
      dockerService as any,
    );
    return { service, dockerService };
  }

  it("throws on unsupported queue mode", async () => {
    const { service } = await createService();
    expect(() => (service as any).resolveMode("invalid_mode")).toThrow(BadRequestException);
  });

  it("caches server resource snapshots within ttl", async () => {
    const { service, dockerService } = await createService();
    const metrics = await import("../../utils/system-metrics");
    const cpuSampler = vi.mocked(metrics.sampleCpuUsagePercent);

    const first = await (service as any).getServerResourcesSnapshot();
    const second = await (service as any).getServerResourcesSnapshot();

    expect(first.cpuUsage).toBe(42);
    expect(second.cpuUsage).toBe(42);
    expect(cpuSampler).toHaveBeenCalledTimes(1);
    expect(dockerService.getPortCapacity).toHaveBeenCalledTimes(1);
  });
});
