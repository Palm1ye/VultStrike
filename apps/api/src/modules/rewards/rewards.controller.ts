import { Body, Controller, Get, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { RateLimit } from "../../decorators/rate-limit.decorator";
import { RewardsService } from "./rewards.service";

@Controller("rewards")
export class RewardsController {
  constructor(@Inject(RewardsService) private readonly rewardsService: RewardsService) {}

  @Get("me")
  async me(@Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.rewardsService.me(authUser.userId);
  }

  @Post("open")
  @RateLimit({ limit: 10, windowMs: 60_000 })
  async openCase(@Req() req: FastifyRequest, @Body() body: { caseType?: string }) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.rewardsService.openCase(authUser.userId, body?.caseType);
  }
}

