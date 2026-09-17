import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyRequest } from "fastify";

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const secrets = (process.env.MATCH_WEBHOOK_SECRET ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (secrets.length === 0) {
      this.logger.warn("MATCH_WEBHOOK_SECRET is not configured; rejecting webhook");
      throw new UnauthorizedException("MATCH_WEBHOOK_SECRET is not configured");
    }

    const signatureHeader = request.headers["x-vultstrike-signature"];
    const timestampHeader = request.headers["x-vultstrike-timestamp"];

    if (typeof signatureHeader !== "string" || typeof timestampHeader !== "string") {
      this.logger.warn("Missing webhook signature headers");
      throw new UnauthorizedException("Missing webhook signature headers");
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      this.logger.warn("Invalid webhook timestamp");
      throw new UnauthorizedException("Invalid webhook timestamp");
    }

    const maxSkewMs = 5 * 60 * 1000;
    const skewMs = Math.abs(Date.now() - timestamp);
    if (skewMs > maxSkewMs) {
      this.logger.warn(`Webhook timestamp skew too large: ${skewMs}ms`);
      throw new UnauthorizedException("Webhook timestamp is too old or in the future");
    }

    const rawBody = (request as any).rawBody;
    const body = typeof rawBody === "string"
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString("utf8")
        : request.body
          ? JSON.stringify(request.body)
          : "";
    const signedPayload = `${timestamp}.${body}`;
    const provided = signatureHeader.replace(/^sha256=/, "");

    const ok = secrets.some((secret) => {
      const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
      return this.safeEqual(expected, provided);
    });

    if (!ok) {
      this.logger.warn("Invalid webhook signature");
      throw new UnauthorizedException("Invalid webhook signature");
    }

    return true;
  }

  private safeEqual(a: string, b: string) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
