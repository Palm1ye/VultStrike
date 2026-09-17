import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { PartyService } from "./party.service";
import { RateLimit } from "../../decorators/rate-limit.decorator";
import type { FastifyRequest } from "fastify";

@Controller("party")
export class PartyController {
  constructor(@Inject(PartyService) private readonly partyService: PartyService) {}

  @Post("create")
  @RateLimit({ limit: 10, windowMs: 60_000 })
  async create(@Body() body: { mode?: string; region?: string }, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.partyService.createParty(authUser.userId, body.mode, body.region);
  }

  @Post("join")
  @RateLimit({ limit: 6, windowMs: 60_000 })
  async join(@Body() body: { code: string }, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    const code = body.code?.trim().toUpperCase();
    // Avoid leaking formatting validation signals. Treat invalid codes as "not found".
    if (!code || !/^P-[A-Z0-9]{6,8}$/.test(code)) {
      throw new NotFoundException("Party not found");
    }
    return this.partyService.joinParty(authUser.userId, code);
  }

  @Post("leave")
  @RateLimit({ limit: 20, windowMs: 60_000 })
  async leave(@Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.partyService.leaveParty(authUser.userId);
  }

  @Post("ready")
  @RateLimit({ limit: 30, windowMs: 60_000 })
  async ready(@Body() body: { ready: boolean }, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.partyService.setReady(authUser.userId, !!body.ready);
  }

  @Get(":id")
  async getById(@Param("id") id: string, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    const party = await this.partyService.getPartyById(id);
    if (authUser.role === "ADMIN" || authUser.role === "MODERATOR") {
      return party;
    }
    const isMember = party.members?.some((m) => m.userId === authUser.userId);
    if (!isMember) {
      throw new ForbiddenException("You are not a member of this party");
    }
    return party;
  }

  @Get("user/:userId")
  async getByUser(@Param("userId") userId: string, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    if (authUser.userId !== userId && authUser.role !== "ADMIN" && authUser.role !== "MODERATOR") {
      throw new UnauthorizedException("You can only view your own party");
    }
    return this.partyService.getPartyByUser(userId);
  }
}
