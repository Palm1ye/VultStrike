import { describe, expect, it, vi } from "vitest";

vi.mock("../../drizzle/client", () => ({
  db: {
    select: vi.fn(),
  },
}));

async function createController(cs2UpdateService: any) {
  const { StatusController } = await import("./status.controller");
  const statusService = {
    getPublicStatus: vi.fn(),
    getControlRoom: vi.fn(),
    getResources: vi.fn(),
    getPublicCs2Compatibility: vi.fn().mockResolvedValue({
      state: "outdated",
      message: "Server update required.",
    }),
  };
  return new StatusController(
    statusService as any,
    cs2UpdateService as any,
  );
}

describe("StatusController", () => {
  it("returns cs2 update status from service", async () => {
    const expected = { running: false, step: "Idle" };
    const cs2UpdateService = {
      getStatus: vi.fn().mockResolvedValue(expected),
      getCompatibilityStatus: vi.fn(),
      startUpdate: vi.fn(),
    };
    const controller = await createController(cs2UpdateService);

    const result = await controller.getCs2UpdateStatus();
    expect(result).toEqual(expected);
    expect(cs2UpdateService.getStatus).toHaveBeenCalledTimes(1);
  });

  it("maps compatibility state to public response message", async () => {
    const cs2UpdateService = {
      getStatus: vi.fn(),
      getCompatibilityStatus: vi.fn(),
      startUpdate: vi.fn(),
    };
    const controller = await createController(cs2UpdateService);

    await expect(controller.getCs2CompatibilityStatus()).resolves.toEqual({
      state: "outdated",
      message: "Server update required.",
    });
  });
});
