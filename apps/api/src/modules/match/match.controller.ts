import { Body, Controller, Get, Inject, Logger, Param, Post, UseGuards, Req, UnauthorizedException, Query } from "@nestjs/common";
import { WebhookSignatureGuard } from "../../guards/webhook-signature.guard";
import { AdminGuard } from "../../guards/admin.guard";
import { MatchService } from "./match.service";
import { WebhookAuditService } from "./webhook-audit.service";
import type { FastifyRequest } from "fastify";
import { RateLimit } from "../../decorators/rate-limit.decorator";

@Controller("matches")
export class MatchController {
  private readonly logger = new Logger(MatchController.name);

  constructor(
    @Inject(MatchService) private readonly matchService: MatchService,
    @Inject(WebhookAuditService) private readonly webhookAudit: WebhookAuditService
  ) {}

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return this.matchService.findOne(id);
  }

  @Get(":id/players")
  async listPlayers(@Param("id") id: string) {
    return this.matchService.listPlayers(id);
  }

  @Get("webhook/health")
  async webhookHealth() {
    return this.webhookAudit.summary();
  }

  @Post("webhook/result")
  @UseGuards(WebhookSignatureGuard)
  async ingestResult(
    @Body()
    payload: { matchId: string; score: [number, number]; winner: string; rated?: boolean; endReason?: string | null }
  ) {
    const startedAt = Date.now();
    this.logger.log(`Webhook result received for match ${payload.matchId}`);
    const res = await this.matchService.recordResult(payload);
    const durationMs = Date.now() - startedAt;
    this.logger.log(`[webhook] ${JSON.stringify({ type: "result", matchId: payload.matchId, ok: !!res.ok, durationMs })}`);
    if (!res.ok) {
      this.logger.warn(`Webhook result failed for match ${payload.matchId}: ${res.error ?? "unknown error"}`);
    }
    this.webhookAudit.record("result", payload.matchId, !!res.ok, res.ok ? null : res.error ?? "unknown error");
    return res;
  }

  @Post("webhook/score")
  @UseGuards(WebhookSignatureGuard)
  async ingestScoreUpdate(
    @Body() payload: { matchId: string; score: { alpha: number; bravo: number }; currentRound: number; durationSeconds: number }
  ) {
    const startedAt = Date.now();
    this.logger.log(`Webhook score received for match ${payload.matchId} (R${payload.currentRound}, ${payload.score.alpha}-${payload.score.bravo})`);
    const res = await this.matchService.updateScore(payload);
    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[webhook] ${JSON.stringify({
        type: "score",
        matchId: payload.matchId,
        ok: !!res.ok,
        durationMs,
        currentRound: payload.currentRound,
        score: payload.score
      })}`
    );
    if (!res.ok) {
      this.logger.warn(`Webhook score failed for match ${payload.matchId}: ${res.error ?? "unknown error"}`);
    }
    this.webhookAudit.record("score", payload.matchId, !!res.ok, res.ok ? null : res.error ?? "unknown error");
    return res;
  }

  @Post("webhook/player")
  @UseGuards(WebhookSignatureGuard)
  async ingestPlayerEvent(
    @Body() payload: { matchId: string; steamId?: string; handle?: string; event: "connected" | "disconnected"; at?: number }
  ) {
    const startedAt = Date.now();
    this.logger.log(`Webhook player ${payload.event} for match ${payload.matchId} (${payload.steamId ?? payload.handle ?? "unknown"})`);
    const res = await this.matchService.recordPlayerEvent(payload);
    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[webhook] ${JSON.stringify({
        type: "player",
        matchId: payload.matchId,
        ok: !!res.ok,
        durationMs,
        event: payload.event,
        steamId: payload.steamId ?? null,
        handle: payload.handle ?? null
      })}`
    );
    if (!res.ok) {
      this.logger.warn(`Webhook player event failed for match ${payload.matchId}: ${res.error ?? "unknown error"}`);
    }
    this.webhookAudit.record("player", payload.matchId, !!res.ok, res.ok ? null : res.error ?? "unknown error");
    return res;
  }

  @Post("webhook/stats")
  @UseGuards(WebhookSignatureGuard)
  async ingestPlayerStats(
    @Body() payload: { matchId: string; players: { steamId: string; name: string; kills: number; deaths: number; assists: number; damage: number }[] }
  ) {
    const startedAt = Date.now();
    this.logger.log(`Webhook stats received for match ${payload.matchId} (${payload.players.length} players)`);
    const res = await this.matchService.updatePlayerStats(payload);
    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[webhook] ${JSON.stringify({ type: "stats", matchId: payload.matchId, ok: !!res.ok, durationMs, players: payload.players.length })}`
    );
    if (!res.ok) {
      this.logger.warn(`Webhook stats failed for match ${payload.matchId}: ${res.error ?? "unknown error"}`);
    }
    this.webhookAudit.record("stats", payload.matchId, !!res.ok, res.ok ? null : res.error ?? "unknown error");
    return res;
  }

  @Post("quickstart")
  @UseGuards(AdminGuard)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  async quickstart(@Body() body: { mode: string; region?: string; map?: string; players: string[] }) {
    return this.matchService.quickstart(body);
  }

  @Post(":id/report")
  @RateLimit({ limit: 6, windowMs: 60_000 })
  async reportMatch(
    @Param("id") id: string,
    @Body() body: { reason: string; details?: string; reportedHandle?: string; reportedUserId?: string },
    @Req() req: FastifyRequest
  ) {
    const user = (req as any).user;
    if (!user?.userId) {
      throw new UnauthorizedException("Sign in required");
    }
    return this.matchService.reportMatch(id, { userId: user.userId, role: user.role }, body);
  }

  @Post("internal")
  @UseGuards(AdminGuard)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  async createInternal(@Body() payload: { lobbyId: string; mode: "1v1" | "2v2" | "3v3"; region: string; map: string; tickets: string[]; avgMmr: number }) {
    return this.matchService.createMatchInternal(payload);
  }

  // Admin endpoints for match management
  @Post("admin/list-open")
  @UseGuards(AdminGuard)
  async listOpenMatches() {
    return this.matchService.listOpenMatches();
  }

  @Post("admin/finish/:id")
  @UseGuards(AdminGuard)
  async finishMatch(
    @Param("id") id: string,
    @Body() body?: { winner?: "ALPHA" | "BRAVO" | "DRAW" }
  ) {
    return this.matchService.finishMatch(id, body?.winner);
  }

  @Post("admin/finish-all")
  @UseGuards(AdminGuard)
  async finishAllMatches() {
    return this.matchService.finishAllMatches();
  }

  @Get("admin/reports")
  @UseGuards(AdminGuard)
  async listReports(@Query("limit") limit?: string) {
    return this.matchService.listReports(Number(limit) || 50);
  }
}
