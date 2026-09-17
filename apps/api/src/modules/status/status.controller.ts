import { Controller, Get, Inject, Post, UseGuards, HttpCode, ConflictException } from "@nestjs/common";
import { Cs2UpdateService } from "./cs2-update.service";
import { StatusService } from "./status.service";
import { AdminGuard } from "../../guards/admin.guard";

@Controller("status")
export class StatusController {
  constructor(
    @Inject(StatusService) private readonly statusService: StatusService,
    @Inject(Cs2UpdateService) private readonly cs2UpdateService: Cs2UpdateService,
  ) {}

  @Get()
  async status() {
    try {
      return await this.statusService.getPublicStatus();
    } catch (err) {
      console.error("/status error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  @Get("control-room")
  async controlRoom() {
    try {
      return await this.statusService.getControlRoom();
    } catch (err) {
      console.error("/status/control-room error:", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  @Get("resources")
  async resources() {
    try {
      return await this.statusService.getResources();
    } catch (err) {
      console.error("/status/resources error:", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  @Get("cs2-update")
  @UseGuards(AdminGuard)
  getCs2UpdateStatus() {
    return this.cs2UpdateService.getStatus();
  }

  @Get("cs2-compatibility")
  async getCs2CompatibilityStatus() {
    return await this.statusService.getPublicCs2Compatibility();
  }

  @Post("cs2-update/start")
  @UseGuards(AdminGuard)
  @HttpCode(202)
  startCs2Update() {
    const started = this.cs2UpdateService.startUpdate();
    if (!started) {
      throw new ConflictException("CS2 update is already in progress");
    }
    return { ok: true, message: "CS2 update started" };
  }
}
