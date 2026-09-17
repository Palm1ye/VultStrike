import { Controller, Get, Post, Body, Query, NotFoundException, Inject, Req, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { CommunityService } from "./community.service";
import { RateLimit } from "../../decorators/rate-limit.decorator";
import type { FastifyRequest } from "fastify";

@Controller("community")
export class CommunityController {
  constructor(@Inject(CommunityService) private readonly communityService: CommunityService) {}

  @Get("shoutbox")
  async getShoutbox(@Query("limit") limit?: string) {
    return this.communityService.getShoutboxMessages(Number(limit) || 30);
  }

  @Post("shoutbox")
  @RateLimit({ limit: 12, windowMs: 60_000 })
  async postShoutbox(@Body() body: { message: string }, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    if (!body.message?.trim()) {
      throw new NotFoundException("message is required");
    }
    return this.communityService.postShoutboxMessage(authUser.userId, body.message.trim());
  }

  @Get("feed")
  async getLiveMatches() {
    return this.communityService.getLiveMatches();
  }

  @Get("stats")
  async getStats(@Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new ForbiddenException("Sign in required");
    }
    return this.communityService.getStats();
  }

  @Get("totals")
  async getTotals() {
    return this.communityService.getTotals();
  }

  @Get("leaderboard")
  async getLeaderboard(@Query("mode") mode?: string, @Query("limit") limit?: string) {
    return this.communityService.getLeaderboard(mode, Number(limit) || 10);
  }
}
