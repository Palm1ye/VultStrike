import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../drizzle/client", () => ({
  db: {
    select: vi.fn(),
  },
}));

async function createService(overrides?: { state?: "compatible" | "outdated" | "checking" | "unknown" }) {
  const { StatusService } = await import("./status.service");
  const cs2UpdateService = {
    getCompatibilityStatus: vi.fn().mockResolvedValue({
      state: overrides?.state ?? "compatible",
      message: "mocked",
      installedBuildId: "1",
      latestBuildId: "1",
      compatible: true,
      checkedAt: new Date().toISOString(),
    }),
  };
  const dockerService = {
    listActiveCs2Servers: vi.fn(),
    getPortCapacity: vi.fn(),
  };

  return {
    service: new StatusService(dockerService as any, cs2UpdateService as any),
    cs2UpdateService,
  };
}

describe("StatusService CS2 compatibility scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warms compatibility on module init and refreshes every two hours", async () => {
    const { service, cs2UpdateService } = await createService({ state: "outdated" });

    await service.onModuleInit();

    expect(cs2UpdateService.getCompatibilityStatus).toHaveBeenCalledWith(true);
    await expect(service.getPublicCs2Compatibility()).resolves.toEqual({
      state: "outdated",
      message: "Server update required.",
    });

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(cs2UpdateService.getCompatibilityStatus).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
  });

  it("returns a checking state before warmup has populated the cache", async () => {
    const { service } = await createService();

    await expect(service.getPublicCs2Compatibility()).resolves.toEqual({
      state: "checking",
      message: "Checking server compatibility.",
    });
  });
});
