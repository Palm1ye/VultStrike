import { Body, Controller, Get, Inject, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { QueueService } from "./queue.service";
import { RateLimit } from "../../decorators/rate-limit.decorator";
import type { FastifyRequest } from "fastify";

@Controller("queues")
export class QueueController {
  constructor(@Inject(QueueService) private readonly queueService: QueueService) {}

  @Get("summary")
  async summaryAll() {
    return this.queueService.summaries();
  }

  @Get(":mode")
  async summary(@Param("mode") mode: string) {
    return this.queueService.summary(mode);
  }

  @Post("join")
  @RateLimit({ limit: 12, windowMs: 60_000 })
  async join(@Body() body: { mode: string; region?: string; partyCode?: string }, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.queueService.join({ ...body, userId: authUser.userId });
  }

  @Post("leave")
  @RateLimit({ limit: 20, windowMs: 60_000 })
  async leave(@Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.queueService.leave({ userId: authUser.userId });
  }
}
