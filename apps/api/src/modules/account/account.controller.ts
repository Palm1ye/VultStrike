import { Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Patch, Post, Req, UnauthorizedException, UseGuards, Query } from "@nestjs/common";
import { AccountService } from "./account.service";
import type { FastifyRequest } from "fastify";
import { AdminGuard } from "../../guards/admin.guard";
import { RateLimit } from "../../decorators/rate-limit.decorator";

@Controller("account")
export class AccountController {
  constructor(@Inject(AccountService) private readonly accountService: AccountService) {}

  @Get("me/queue")
  async myQueueStatus(@Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.accountService.queueStatus(authUser.userId);
  }

  @Get(":userId")
  async profile(@Param("userId") userId: string, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    const profile = await this.accountService.profile(userId, authUser?.userId);
    const isSelf = authUser?.userId === userId;

    if (!isSelf) {
      return {
        ...profile,
        steamId: null,
        steamDisplayName: null,
        steamAvatar: null
      };
    }

    return profile;
  }

  @Get(":userId/queue")
  async queueStatus(@Param("userId") userId: string, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser || authUser.userId !== userId) {
      throw new UnauthorizedException("You can only view your own queue status");
    }
    return this.accountService.queueStatus(userId);
  }

  @Get(":userId/customization")
  async getCustomization(@Param("userId") userId: string) {
    return this.accountService.getCustomization(userId);
  }

  @Patch(":userId/customization")
  async updateCustomization(
    @Param("userId") userId: string,
    @Body() body: { theme?: string; border?: string; avatar?: string; status?: string },
    @Req() req: FastifyRequest
  ) {
    // Verify the requesting user is the same as the userId being updated
    const authUser = (req as any).user;
    if (!authUser || authUser.userId !== userId) {
      throw new UnauthorizedException("You can only update your own profile customization");
    }
    return this.accountService.updateCustomization(userId, body);
  }

  @Get(":userId/sessions")
  async getSessions(@Param("userId") userId: string, @Req() req: FastifyRequest) {
    const authUser = (req as any).user;
    if (!authUser || authUser.userId !== userId) {
      throw new UnauthorizedException("You can only view your own sessions");
    }
    const currentSessionId = (req as any).sessionId;
    return this.accountService.getSessions(userId, currentSessionId);
  }

  @Delete(":userId/sessions/:sessionId")
  async terminateSession(
    @Param("userId") userId: string,
    @Param("sessionId") sessionId: string,
    @Req() req: FastifyRequest
  ) {
    const authUser = (req as any).user;
    if (!authUser || authUser.userId !== userId) {
      throw new UnauthorizedException("You can only terminate your own sessions");
    }
    const currentSessionId = (req as any).sessionId;
    if (sessionId === currentSessionId) {
      throw new UnauthorizedException("Cannot terminate current session");
    }
    return this.accountService.terminateSession(userId, sessionId);
  }

  @Post("authenticate")
  @RateLimit({ limit: 8, windowMs: 60_000, key: "auth.session" })
  async authenticate(@Body() body: { provider: "steam" | "discord" | "email"; identifier: string }) {
    const allowByDefault = (process.env.NODE_ENV ?? "development").toLowerCase() !== "production";
    const allow = (process.env.ALLOW_PASSWORDLESS_SESSION ?? String(allowByDefault)).toLowerCase() === "true";
    if (!allow) {
      throw new ForbiddenException("Passwordless sessions are disabled.");
    }
    return this.accountService.authenticate(body);
  }

  @Post("admin/ban")
  @UseGuards(AdminGuard)
  async banUser(
    @Body() body: { userId?: string; handle?: string; reason?: string; durationMinutes?: number; durationHours?: number; durationDays?: number; until?: string },
    @Req() req: FastifyRequest
  ) {
    const adminId = (req as any).user?.userId ?? null;
    return this.accountService.banUser({ ...body, adminId });
  }

  @Post("admin/unban")
  @UseGuards(AdminGuard)
  async unbanUser(@Body() body: { userId?: string; handle?: string }, @Req() req: FastifyRequest) {
    const adminId = (req as any).user?.userId ?? null;
    return this.accountService.unbanUser(body);
  }

  @Get("admin/ban-history")
  @UseGuards(AdminGuard)
  async banHistory(@Query("limit") limit?: string) {
    return this.accountService.getBanHistory(Number(limit) || 50);
  }
}
