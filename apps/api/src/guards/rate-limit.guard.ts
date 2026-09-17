import { CanActivate, ExecutionContext, Inject, Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { RATE_LIMIT_KEY, RateLimitOptions } from "../decorators/rate-limit.decorator";

type Bucket = { count: number; resetAt: number };
type BucketRule = { key: string; limit: number };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly buckets = new Map<string, Bucket>();
  private static lastCleanup = 0;

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Reflector may not be injected in certain Node/NestJS version combos.
    if (!this.reflector) return true;

    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!options) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();

    const now = Date.now();
    this.cleanup(now);

    const routeKey = options.key ?? `${context.getClass().name}.${context.getHandler().name}`;
    const bucketRules = this.buildBucketRules(routeKey, options, req);

    let minRemaining = Number.POSITIVE_INFINITY;
    let resetAt = now + options.windowMs;
    let retryAfter = 0;
    let blocked = false;

    for (const rule of bucketRules) {
      const bucketKey = `${routeKey}:${rule.key}`;

      let bucket = RateLimitGuard.buckets.get(bucketKey);
      if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + options.windowMs };
        RateLimitGuard.buckets.set(bucketKey, bucket);
      }

      bucket.count += 1;
      const remaining = Math.max(0, rule.limit - bucket.count);
      minRemaining = Math.min(minRemaining, remaining);
      resetAt = Math.min(resetAt, bucket.resetAt);

      if (bucket.count > rule.limit) {
        blocked = true;
        retryAfter = Math.max(retryAfter, Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      }
    }

    res.header("X-RateLimit-Limit", String(bucketRules[0]?.limit ?? options.limit));
    res.header("X-RateLimit-Remaining", String(Number.isFinite(minRemaining) ? minRemaining : options.limit));
    res.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (blocked) {
      res.header("Retry-After", String(retryAfter));
      throw new HttpException("Too many requests, please slow down.", HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private getClientIp(req: FastifyRequest): string {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      return xff.split(",")[0].trim();
    }
    if (Array.isArray(xff) && xff.length) {
      return xff[0];
    }
    return req.ip ?? req.socket?.remoteAddress ?? "unknown";
  }

  private buildBucketRules(routeKey: string, options: RateLimitOptions, req: FastifyRequest): BucketRule[] {
    const ip = this.getClientIp(req);
    const authUser = (req as any).user;
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "unknown";
    const uaHash = createHash("sha1").update(userAgent).digest("hex").slice(0, 12);
    const networkIdentity = `ipua:${ip}:${uaHash}`;

    if (routeKey === "auth.session") {
      const body = (req.body ?? {}) as { provider?: string; identifier?: string };
      const provider = (body.provider ?? "unknown").toString().trim().toLowerCase();
      const identifier = (body.identifier ?? "unknown").toString().trim().toLowerCase();
      const identifierHash = createHash("sha1").update(`${provider}:${identifier}`).digest("hex").slice(0, 16);
      return [
        { key: `session-target:${networkIdentity}:${identifierHash}`, limit: options.limit },
        { key: `session-network:${networkIdentity}`, limit: Math.max(options.limit * 3, options.limit + 12) }
      ];
    }

    if (routeKey === "auth.logout") {
      if (authUser?.userId) {
        return [
          { key: `logout-user:${authUser.userId}`, limit: options.limit },
          { key: `logout-network:${networkIdentity}`, limit: Math.max(options.limit * 2, options.limit + 20) }
        ];
      }
      return [{ key: `logout-network:${networkIdentity}`, limit: options.limit }];
    }

    const identity = authUser?.userId ? `user:${authUser.userId}` : `ip:${ip}`;
    return [{ key: identity, limit: options.limit }];
  }

  private cleanup(now: number) {
    if (now - RateLimitGuard.lastCleanup < 60_000) return;
    RateLimitGuard.lastCleanup = now;
    for (const [key, bucket] of RateLimitGuard.buckets.entries()) {
      if (now > bucket.resetAt) {
        RateLimitGuard.buckets.delete(key);
      }
    }
  }
}
