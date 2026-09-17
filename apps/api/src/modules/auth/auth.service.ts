import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AccountService } from "../account/account.service";

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";

@Injectable()
export class AuthService {
  constructor(@Inject(AccountService) private readonly accountService: AccountService) {}

  getSteamRedirectUrl(returnTo?: string) {
    const baseUrl = this.getPublicBaseUrl();
    const webBase = this.getWebBaseUrl();
    const safeReturn = returnTo && returnTo.startsWith(webBase) ? returnTo : webBase;
    const callback = `${baseUrl}/auth/steam/callback?returnTo=${encodeURIComponent(safeReturn)}`;

    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": callback,
      "openid.realm": baseUrl,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
    });

    return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
  }

  async handleSteamCallback(request: FastifyRequest) {
    const query = request.query as Record<string, string | string[] | undefined>;
    const claimedId = this.extractClaimedId(query);
    const steamId = this.extractSteamId(claimedId);

    await this.verifyAssertion(query);

    const user = await this.accountService.upsertSteamUser(steamId);
    const token = this.accountService.signSessionToken(user, "steam");

    return {
      ok: true,
      steamId,
      userId: user.id,
      userHandle: user.handle,
      accessToken: token,
      expiresIn: process.env.JWT_EXPIRES_IN ?? "1h"
    };
  }

  async createSession(provider: "steam" | "discord" | "email", identifier: string) {
    return this.accountService.authenticate({ provider, identifier });
  }

  getSessionFromToken(token: string) {
    return this.accountService.verifySessionToken(token);
  }

  private getPublicBaseUrl() {
    const env = process.env.API_PUBLIC_URL;
    if (env && env.trim().length > 0) return env.replace(/\/$/, "");
    const port = process.env.PORT ?? "4000";
    return `http://localhost:${port}`;
  }

  getWebBaseUrl() {
    const env = process.env.WEB_PUBLIC_URL;
    if (env && env.trim().length > 0) return env.replace(/\/$/, "");
    return "http://localhost:3000";
  }

  private extractClaimedId(query: Record<string, string | string[] | undefined>) {
    const claimed = query["openid.claimed_id"] ?? query["openid.identity"];
    if (!claimed) {
      throw new BadRequestException("Missing OpenID claimed_id");
    }
    return Array.isArray(claimed) ? claimed[0] : claimed;
  }

  private extractSteamId(claimedId: string) {
    const match = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/.exec(claimedId);
    if (!match) {
      throw new BadRequestException("Invalid Steam OpenID identity");
    }
    return match[1];
  }

  private async verifyAssertion(query: Record<string, string | string[] | undefined>) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (typeof value === "undefined") return;
      params.append(key, Array.isArray(value) ? value[0] : value);
    });
    params.set("openid.mode", "check_authentication");

    const response = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    const body = await response.text();
    if (!body.includes("is_valid:true")) {
      throw new UnauthorizedException("Steam OpenID verification failed");
    }
  }
}