import { Body, Controller, ForbiddenException, Get, Inject, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "./auth.service";
import { RateLimit } from "../../decorators/rate-limit.decorator";

function getCookieHeaderValues(header: string | undefined, name: string): string[] {
  if (!header) return [];
  const out: string[] = [];
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    const value = part.slice(idx + 1).trim();
    if (value) out.push(value);
  }
  return out;
}

function normalizeToken(raw: string): string {
  const trimmed = raw.trim();
  const unquoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;
  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get("steam")
  @RateLimit({ limit: 60, windowMs: 60_000 })
  steamRedirect(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const query = request.query as Record<string, string | string[] | undefined>;
    const rawReturn = query.returnTo;
    const returnTo = Array.isArray(rawReturn) ? rawReturn[0] : rawReturn;
    const url = this.authService.getSteamRedirectUrl(returnTo);
    return reply
      .status(302)
      .header("Location", url)
      .type("text/html")
      .send(
        `<!doctype html><html><head><meta charset="utf-8" /><meta http-equiv="refresh" content="0;url=${url}" /></head><body style="font-family:system-ui;background:#0b0d10;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;max-width:520px;">
<h1 style="font-size:20px;margin-bottom:8px;">Redirecting to Steam…</h1>
<p style="opacity:0.7;">If you are not redirected, <a href="${url}" style="color:#f59e0b;">click here to continue</a>.</p>
</div></body></html>`
      );
  }

  @Get("steam/callback")
  @RateLimit({ limit: 60, windowMs: 60_000 })
  async steamCallback(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const base = this.authService.getWebBaseUrl();
    try {
      const result = await this.authService.handleSteamCallback(request);
      this.setSessionCookie(reply, result.accessToken);
      const redirect = this.resolveRedirect(request) ?? base;
      const redirectWithToken = this.maybeAttachSession(redirect, result.accessToken, result.userId);
      return reply
        .status(302)
        .header("Location", redirectWithToken)
        .type("text/html")
        .send(
          `<!doctype html><html><head><meta charset="utf-8" /><meta http-equiv="refresh" content="0;url=${redirectWithToken}" /></head><body style="font-family:system-ui;background:#0b0d10;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;max-width:520px;">
<h1 style="font-size:20px;margin-bottom:8px;">Signing you in…</h1>
<p style="opacity:0.7;">If you are not redirected, <a href="${redirectWithToken}" style="color:#f59e0b;">click here to continue</a>.</p>
</div></body></html>`
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Steam login failed";
      const redirect = `${base}/?authError=${encodeURIComponent(message)}`;
      return reply
        .status(302)
        .header("Location", redirect)
        .type("text/html")
        .send(
          `<!doctype html><html><head><meta charset="utf-8" /><meta http-equiv="refresh" content="0;url=${redirect}" /></head><body style="font-family:system-ui;background:#0b0d10;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;max-width:520px;">
<h1 style="font-size:20px;margin-bottom:8px;">Steam login failed</h1>
<p style="opacity:0.7;">If you are not redirected, <a href="${redirect}" style="color:#f59e0b;">click here to continue</a>.</p>
</div></body></html>`
        );
    }
  }

  private maybeAttachSession(redirect: string, token: string, userId: string) {
    const isProd = (process.env.NODE_ENV ?? "development").toLowerCase() === "production";
    // Never put session tokens in URLs in production (leaks via logs, referrers, screenshots).
    if (isProd) return redirect;

    const allow = (process.env.ALLOW_TOKEN_QUERY ?? "true").toLowerCase() === "true";
    if (!allow) return redirect;
    const [base, hash = ""] = redirect.split("#");
    const url = new URL(base);
    url.searchParams.set("authToken", token);
    url.searchParams.set("userId", userId);
    return `${url.toString()}${hash ? `#${hash}` : ""}`;
  }

  @Post("session")
  @RateLimit({ limit: 8, windowMs: 60_000, key: "auth.session" })
  async createSession(@Body() body: { provider: "steam" | "discord" | "email"; identifier: string }, @Res() reply: FastifyReply) {
    const allowByDefault = (process.env.NODE_ENV ?? "development").toLowerCase() !== "production";
    const allow = (process.env.ALLOW_PASSWORDLESS_SESSION ?? String(allowByDefault)).toLowerCase() === "true";
    if (!allow) {
      throw new ForbiddenException("Passwordless sessions are disabled.");
    }
    const result = await this.authService.createSession(body.provider, body.identifier);
    this.setSessionCookie(reply, result.sessionToken);
    return reply.send({ ok: true, userId: result.userId, userHandle: result.userHandle, sessionToken: result.sessionToken });
  }

  @Post("logout")
  @RateLimit({ limit: 30, windowMs: 60_000, key: "auth.logout" })
  logout(@Res() reply: FastifyReply) {
    this.clearSessionCookie(reply);
    return reply.send({ ok: true });
  }

  @Get("me")
  me(@Req() request: FastifyRequest) {
    const name = process.env.COOKIE_NAME ?? "vultstrike_session";
    const authHeader = request.headers?.authorization;
    const bearerToken =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;

    const fromCookies = request.cookies?.[name];
    const fromHeaderValues = getCookieHeaderValues(request.headers?.cookie, name);

    const candidates: string[] = [];
    if (bearerToken) candidates.push(bearerToken);
    if (fromCookies) candidates.push(fromCookies);
    candidates.push(...fromHeaderValues);

    const seen = new Set<string>();
    for (const raw of candidates) {
      const token = normalizeToken(raw);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      try {
        const session = this.authService.getSessionFromToken(token);
        if (session.userId) {
          return session;
        }
      } catch {
        // Keep trying other candidates.
      }
    }

    if (!candidates.length) {
      throw new UnauthorizedException("Missing session");
    }
    throw new UnauthorizedException("Invalid session");
  }

  private resolveRedirect(request: FastifyRequest) {
    const query = request.query as Record<string, string | string[] | undefined>;
    const raw = query.returnTo ?? query.redirect;
    if (!raw) return this.authService.getWebBaseUrl();
    const value = Array.isArray(raw) ? raw[0] : raw;
    const base = this.authService.getWebBaseUrl();
    if (value.startsWith(base)) {
      return value;
    }
    return base;
  }

  private setSessionCookie(reply: FastifyReply, token: string) {
    const name = process.env.COOKIE_NAME ?? "vultstrike_session";
    const secure = (process.env.COOKIE_SECURE ?? "false").toLowerCase() === "true";
    const domain = process.env.COOKIE_DOMAIN;
    const maxAge = this.parseMaxAge(process.env.JWT_EXPIRES_IN ?? "7d");

    reply.setCookie(name, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      ...(domain ? { domain } : {}),
      ...(maxAge ? { maxAge } : {})
    });
  }

  private clearSessionCookie(reply: FastifyReply) {
    const name = process.env.COOKIE_NAME ?? "vultstrike_session";
    const secure = (process.env.COOKIE_SECURE ?? "false").toLowerCase() === "true";
    const domain = process.env.COOKIE_DOMAIN;
    reply.clearCookie(name, {
      path: "/",
      secure,
      ...(domain ? { domain } : {})
    });
  }

  private parseMaxAge(value: string) {
    const match = /^(\d+)([smhd])$/.exec(value.trim());
    if (!match) return undefined;
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) return undefined;
    const seconds = unit === "s" ? amount : unit === "m" ? amount * 60 : unit === "h" ? amount * 3600 : amount * 86400;
    return seconds;
  }
}
