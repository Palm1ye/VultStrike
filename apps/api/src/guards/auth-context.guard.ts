import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AccountService } from "../modules/account/account.service";

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

@Injectable()
export class AuthContextGuard implements CanActivate {
  constructor(@Inject(AccountService) private readonly accountService: AccountService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();

    const cookieName = process.env.COOKIE_NAME ?? "vultstrike_session";
    const fromCookies = (req as any).cookies?.[cookieName] as string | undefined;
    const fromHeaderValues = getCookieHeaderValues(req.headers?.cookie, cookieName);

    const authHeader = req.headers?.authorization;
    const bearerToken =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;

    const candidates: string[] = [];
    // Prefer explicit Authorization header. This avoids stale cookies breaking valid bearer sessions.
    if (bearerToken) candidates.push(bearerToken);
    if (fromCookies) candidates.push(fromCookies);
    candidates.push(...fromHeaderValues);

    const seen = new Set<string>();
    for (const raw of candidates) {
      const token = normalizeToken(raw);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      try {
        const session = this.accountService.verifySessionToken(token);
        if (session.userId) {
          (req as any).user = {
            userId: session.userId,
            handle: session.handle,
            role: session.role,
            provider: session.provider
          };
          break;
        }
      } catch {
        // Ignore invalid tokens: keep trying other candidates.
      }
    }

    return true;
  }
}
