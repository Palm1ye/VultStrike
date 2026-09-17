import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { db } from "../../drizzle/client";
import { user as userTable, match as matchTable, queueTicket, matchParticipant, userSession, userBanLog } from "../../drizzle/schema";
import { eq, inArray, and, or, sql, desc } from "drizzle-orm";
import { PartyService } from "../party/party.service";
import { assertUserNotBanned } from "../../utils/ban";

type QueueMode = 'ONE_V_ONE' | 'TWO_V_TWO' | 'THREE_V_THREE';
type Role = 'ADMIN' | 'MODERATOR' | 'USER';
type User = typeof userTable.$inferSelect;

type Provider = "steam" | "discord" | "email";

@Injectable()
export class AccountService {
  constructor(@Inject(PartyService) private readonly partyService: PartyService) {}

  async profile(userId: string, viewerUserId?: string) {
    const foundUser = await this.findUserOrThrow(userId);
    const steamProfile = await this.fetchSteamProfile(foundUser.steamId ?? undefined);
    const ratedFinishedMatchFilter = and(
      eq(matchParticipant.userId, foundUser.id),
      eq(matchTable.status, "FINISHED"),
      sql`${matchTable.serverStatus} is distinct from 'FAILED'`,
      sql`(${matchTable.serverError} is null or ${matchTable.serverError} not like 'UNRATED:%')`
    );
    const recentMatches = await db
      .select({
        id: matchTable.id,
        status: matchTable.status,
        map: matchTable.map,
        lobbyCode: matchTable.lobbyCode,
        serverEndpoint: matchTable.serverEndpoint,
        mmrDelta: matchTable.mmrDelta,
        scoreAlpha: matchTable.scoreAlpha,
        scoreBravo: matchTable.scoreBravo,
        winner: matchTable.winner,
        createdAt: matchTable.createdAt
      })
      .from(matchParticipant)
      .innerJoin(matchTable, eq(matchParticipant.matchId, matchTable.id))
      .where(ratedFinishedMatchFilter)
      .orderBy(desc(matchTable.createdAt))
      .limit(5);
    const lastMatch = recentMatches[0] ?? null;
    const [statsRow] = await db
      .select({
        wins: sql<number>`sum(case when ${matchTable.winner} = ${matchParticipant.team} then 1 else 0 end)`,
        losses: sql<number>`sum(case when ${matchTable.winner} != ${matchParticipant.team} and ${matchTable.winner} != 'DRAW' then 1 else 0 end)`,
        draws: sql<number>`sum(case when ${matchTable.winner} = 'DRAW' then 1 else 0 end)`,
        total: sql<number>`count(*)`
      })
      .from(matchParticipant)
      .innerJoin(matchTable, eq(matchParticipant.matchId, matchTable.id))
      .where(ratedFinishedMatchFilter);

    const wins = Number(statsRow?.wins ?? 0);
    const losses = Number(statsRow?.losses ?? 0);
    const draws = Number(statsRow?.draws ?? 0);
    const total = Number(statsRow?.total ?? 0);
    const decisive = wins + losses;
    const winRate = decisive > 0 ? Math.round((wins / decisive) * 100) : null;
    // Ensure displayName is never empty - fallback to steam profile name or handle
    const effectiveDisplayName = foundUser.displayName?.trim() 
      || steamProfile?.personaname 
      || foundUser.handle 
      || "Steam User";
    
    const canViewCompetitiveDetails = Boolean(viewerUserId);

    return {
      id: foundUser.id,
      handle: foundUser.handle,
      displayName: effectiveDisplayName,
      visibility: {
        isAuthenticated: Boolean(viewerUserId),
        isSelf: viewerUserId === foundUser.id,
        canViewCompetitiveDetails
      },
      role: foundUser.role,
      trustScore: foundUser.trustScore,
      steamId: foundUser.steamId ?? "unlinked",
      steamDisplayName: steamProfile?.personaname ?? null,
      steamAvatar: steamProfile?.avatarfull ?? null,
      banned: foundUser.banned ?? false,
      banReason: foundUser.banReason ?? null,
      banUntil: foundUser.banUntil ?? null,
      mmr: {
        "1v1": canViewCompetitiveDetails ? foundUser.mmr1v1 : null,
        "2v2": canViewCompetitiveDetails ? foundUser.mmr2v2 : null,
        "3v3": canViewCompetitiveDetails ? foundUser.mmr3v3 : null
      },
      placement: {
        "1v1": { matches: foundUser.placementMatches1v1 ?? 0, completed: (foundUser.mmr1v1 ?? 0) > 0 },
        "2v2": { matches: foundUser.placementMatches2v2 ?? 0, completed: (foundUser.mmr2v2 ?? 0) > 0 },
        "3v3": { matches: foundUser.placementMatches3v3 ?? 0, completed: (foundUser.mmr3v3 ?? 0) > 0 }
      },
      subscription: this.deriveSubscription(foundUser.role),
      customization: {
        theme: foundUser.profileTheme ?? "default",
        border: foundUser.profileBorder ?? "default",
        avatar: foundUser.profileAvatar ?? "default",
        status: foundUser.profileStatus ?? ""
      },
      lastMatch: lastMatch
        ? {
            id: lastMatch.id,
            map: lastMatch.map,
            status: lastMatch.status,
            mmrDelta: canViewCompetitiveDetails ? lastMatch.mmrDelta : null,
            completedAt: lastMatch.createdAt ?? null
          }
        : null,
      recentMatches: recentMatches.map((match) => ({
        id: match.id,
        map: match.map,
        status: match.status,
        mmrDelta: canViewCompetitiveDetails ? match.mmrDelta : null,
        scoreAlpha: match.scoreAlpha ?? 0,
        scoreBravo: match.scoreBravo ?? 0,
        winner: match.winner ?? null,
        completedAt: match.createdAt ?? null
      })),
      stats: {
        wins,
        losses,
        draws,
        matches: total,
        winRate
      }
    };
  }

  async updateCustomization(userId: string, data: { theme?: string; border?: string; avatar?: string; status?: string }) {
    const foundUser = await this.findUserOrThrow(userId);
    
    const updateData: Record<string, string> = {};
    if (data.theme) updateData.profileTheme = data.theme;
    if (data.border) updateData.profileBorder = data.border;
    if (data.avatar) updateData.profileAvatar = data.avatar;
    if (typeof data.status === 'string') updateData.profileStatus = data.status.slice(0, 64);
    
    if (Object.keys(updateData).length > 0) {
      await db.update(userTable).set(updateData).where(eq(userTable.id, foundUser.id));
    }
    
    return { ok: true, updated: updateData };
  }

  async getCustomization(userId: string) {
    const foundUser = await this.findUserOrThrow(userId);
    return {
      theme: foundUser.profileTheme ?? "default",
      border: foundUser.profileBorder ?? "default",
      avatar: foundUser.profileAvatar ?? "default",
      status: foundUser.profileStatus ?? ""
    };
  }

  async queueStatus(userId: string) {
    const foundUser = await this.findUserOrThrow(userId);
    const [ticket] = await db
      .select()
      .from(queueTicket)
      .where(
        and(
          eq(queueTicket.userId, foundUser.id),
          inArray(queueTicket.status, ['ENQUEUED', 'MATCHED']),
          sql`${queueTicket.createdAt} > now() - interval '10 minutes'`
        )
      );

    // Look up active match for this user - check both MATCHED ticket status AND recent participant records
    let activeMatch = null;
    
    // First try to find match from ticket status
    if (ticket?.status === 'MATCHED') {
      // Find the most recent match this user is part of
      const participantMatches = await db
        .select({ matchId: matchParticipant.matchId })
        .from(matchParticipant)
        .where(eq(matchParticipant.userId, foundUser.id))
        .orderBy(sql`created_at DESC`)
        .limit(1);
      
      if (participantMatches.length > 0) {
        const [matchData] = await db
          .select({
            id: matchTable.id,
            status: matchTable.status,
            map: matchTable.map,
            lobbyCode: matchTable.lobbyCode,
            serverEndpoint: matchTable.serverEndpoint
          })
          .from(matchTable)
          .where(and(
            eq(matchTable.id, participantMatches[0].matchId),
            inArray(matchTable.status, ['PENDING', 'IN_PROGRESS'])
          ));
        if (matchData) {
          activeMatch = {
            id: matchData.id,
            status: matchData.status,
            map: matchData.map,
            lobbyCode: matchData.lobbyCode,
            serverEndpoint: matchData.serverEndpoint,
            connect: matchData.serverEndpoint
          };
        }
      }
    }
    
    // Also check for recent matches even without a MATCHED ticket (in case ticket was cleared)
    if (!activeMatch) {
      const recentParticipantMatches = await db
        .select({ matchId: matchParticipant.matchId })
        .from(matchParticipant)
        .where(eq(matchParticipant.userId, foundUser.id))
        .orderBy(sql`created_at DESC`)
        .limit(1);
      
      if (recentParticipantMatches.length > 0) {
        const [matchData] = await db
          .select({
            id: matchTable.id,
            status: matchTable.status,
            map: matchTable.map,
            lobbyCode: matchTable.lobbyCode,
            serverEndpoint: matchTable.serverEndpoint
          })
          .from(matchTable)
          .where(and(
            eq(matchTable.id, recentParticipantMatches[0].matchId),
            inArray(matchTable.status, ['PENDING', 'IN_PROGRESS'])
          ));
        if (matchData) {
          activeMatch = {
            id: matchData.id,
            status: matchData.status,
            map: matchData.map,
            lobbyCode: matchData.lobbyCode,
            serverEndpoint: matchData.serverEndpoint,
            connect: matchData.serverEndpoint
          };
        }
      }
    }

    const mode = ticket?.mode ?? 'TWO_V_TWO';
    const etaSeconds = this.estimateEta(mode);

    const partyInfo = await this.partyService.getPartyByUser(foundUser.id);
    const partyMembers = partyInfo?.members?.length
      ? partyInfo.members.map((member) => {
          const name =
            (member.displayName ?? "").trim() ||
            member.handle ||
            member.userId;
          return {
            userId: member.userId,
            name,
            role: member.role ?? "MEMBER",
            ready: !!member.ready
          };
        })
      : [
          {
            userId: foundUser.id,
            name: foundUser.handle,
            role: this.deriveRoleFromMode(mode),
            ready: true
          }
        ];

    return {
      userId: foundUser.id,
      activeTicket: ticket?.id ?? null,
      etaSeconds,
      preferredRegions: ticket ? [ticket.region] : ["GLOBAL"],
      penaltyFreeDodges: Math.max(0, 3 - Math.floor(((foundUser.trustScore ?? 60) - 60) / 10)),
      match: activeMatch,
      party: partyMembers,
      partyId: partyInfo?.id ?? null,
      partyCode: partyInfo?.code ?? null,
      partyLeaderId: partyInfo?.leaderUserId ?? null,
      partyMode: partyInfo?.mode ?? null,
      partyRegion: partyInfo?.region ?? null
    };
  }

  async authenticate(body: { provider: Provider; identifier: string }) {
    const handleNorm = this.normalizeHandle(body.identifier);
    // Upsert user by handle
    let [user] = await db.select().from(userTable).where(eq(userTable.handle, handleNorm));
    if (user) {
      // No updatedAt field in schema, so skip update
    } else {
      const [created] = await db.insert(userTable).values({
        id: crypto.randomUUID(),
        handle: handleNorm,
        displayName: body.identifier,
        trustScore: 82,
        role: 'USER',
        mmr1v1: 0,
        mmr2v2: 0,
        mmr3v3: 0,
        placementMatches1v1: 0,
        placementMatches2v2: 0,
        placementMatches3v3: 0
      }).returning();
      user = created;
    }

    await assertUserNotBanned(user);

    const sessionToken = this.signSessionToken(user, body.provider);

    return {
      ok: true,
      sessionToken,
      expiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
      provider: body.provider,
      identifier: body.identifier,
      userId: user.id,
      userHandle: user.handle,
      mfaRequired: body.provider === "email"
    };
  }

  async upsertSteamUser(steamId: string) {
    // Fetch real Steam display name from Steam API
    const steamProfile = await this.fetchSteamProfile(steamId);
    const realDisplayName = steamProfile?.personaname ?? `Steam ${steamId}`;

    const [existing] = await db.select().from(userTable).where(eq(userTable.steamId, steamId));
    if (existing) {
      await assertUserNotBanned(existing);
      // Update display name if it's the old generic format
      if (existing.displayName?.startsWith('Steam ') && steamProfile?.personaname) {
        await db.update(userTable)
          .set({ displayName: realDisplayName })
          .where(eq(userTable.id, existing.id));
        return { ...existing, displayName: realDisplayName };
      }
      return existing;
    }
    
    const baseHandle = `steam_${steamId}`;
    const handle = await this.ensureUniqueHandle(baseHandle);
    const [created] = await db.insert(userTable).values({
      id: crypto.randomUUID(),
      handle,
      displayName: realDisplayName,
      steamId,
      trustScore: 85,
      role: 'USER',
      mmr1v1: 0,
      mmr2v2: 0,
      mmr3v3: 0,
      placementMatches1v1: 0,
      placementMatches2v2: 0,
      placementMatches3v3: 0,
      placementWins1v1: 0,
      placementWins2v2: 0,
      placementWins3v3: 0
    }).returning();
    await assertUserNotBanned(created);
    return created;
  }

  async banUser(body: {
    userId?: string;
    handle?: string;
    reason?: string;
    durationMinutes?: number;
    durationHours?: number;
    durationDays?: number;
    until?: string;
    adminId?: string | null;
  }) {
    const target = body.userId ?? body.handle;
    if (!target) {
      throw new BadRequestException("userId or handle is required");
    }

    const user = await this.findUserOrThrow(target);
    const reason = body.reason?.trim().slice(0, 256) || null;

    let until: Date | null = null;
    if (body.until) {
      const parsed = new Date(body.until);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException("Invalid ban until date");
      }
      until = parsed;
    } else {
      const minutes = Number(body.durationMinutes ?? 0);
      const hours = Number(body.durationHours ?? 0);
      const days = Number(body.durationDays ?? 0);
      const durationMs = Math.max(0, minutes) * 60_000 + Math.max(0, hours) * 3_600_000 + Math.max(0, days) * 86_400_000;
      if (durationMs > 0) {
        until = new Date(Date.now() + durationMs);
      }
    }

    await db
      .update(userTable)
      .set({ banned: true, banReason: reason, banUntil: until })
      .where(eq(userTable.id, user.id));

    await db
      .insert(userBanLog)
      .values({
        userId: user.id,
        adminId: body.adminId ?? null,
        action: "BAN",
        reason,
        banUntil: until
      });

    return {
      ok: true,
      userId: user.id,
      banned: true,
      banReason: reason,
      banUntil: until
    };
  }

  async unbanUser(body: { userId?: string; handle?: string; adminId?: string | null }) {
    const target = body.userId ?? body.handle;
    if (!target) {
      throw new BadRequestException("userId or handle is required");
    }

    const user = await this.findUserOrThrow(target);
    await db
      .update(userTable)
      .set({ banned: false, banReason: null, banUntil: null })
      .where(eq(userTable.id, user.id));

    await db
      .insert(userBanLog)
      .values({
        userId: user.id,
        adminId: body.adminId ?? null,
        action: "UNBAN",
        reason: null,
        banUntil: null
      });

    return { ok: true, userId: user.id, banned: false };
  }

  async getBanHistory(limit = 50) {
    const capped = Math.min(Math.max(1, limit), 200);
    const logs = await db
      .select({
        id: userBanLog.id,
        userId: userBanLog.userId,
        adminId: userBanLog.adminId,
        action: userBanLog.action,
        reason: userBanLog.reason,
        banUntil: userBanLog.banUntil,
        createdAt: userBanLog.createdAt
      })
      .from(userBanLog)
      .orderBy(desc(userBanLog.createdAt))
      .limit(capped);

    const ids = Array.from(
      new Set(
        logs.flatMap((log) => [log.userId, log.adminId].filter(Boolean) as string[])
      )
    );

    const users = ids.length
      ? await db
          .select({
            id: userTable.id,
            handle: userTable.handle,
            displayName: userTable.displayName
          })
          .from(userTable)
          .where(inArray(userTable.id, ids))
      : [];

    const userMap = new Map(users.map((u) => [u.id, u]));

    return logs.map((log) => ({
      ...log,
      user: userMap.get(log.userId) ?? { id: log.userId, handle: log.userId, displayName: null },
      admin: log.adminId ? userMap.get(log.adminId) ?? { id: log.adminId, handle: log.adminId, displayName: null } : null
    }));
  }

  signSessionToken(user: User, provider: Provider) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const issuer = process.env.JWT_ISSUER ?? "vultstrike";
    const audience = process.env.JWT_AUDIENCE ?? "vultstrike-web";
    const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";

    const payload = {
      sub: user.id,
      handle: user.handle,
      role: user.role,
      provider
    };

    const options: jwt.SignOptions = {
      issuer,
      audience,
      expiresIn: expiresIn as jwt.SignOptions["expiresIn"]
    };
    return jwt.sign(payload, secret as jwt.Secret, options);
  }

  verifySessionToken(token: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const issuer = process.env.JWT_ISSUER ?? "vultstrike";
    const audience = process.env.JWT_AUDIENCE ?? "vultstrike-web";

    const decoded = jwt.verify(token, secret as jwt.Secret, { issuer, audience }) as jwt.JwtPayload;
    return {
      userId: typeof decoded.sub === "string" ? decoded.sub : undefined,
      handle: typeof decoded.handle === "string" ? decoded.handle : undefined,
      role: typeof decoded.role === "string" ? decoded.role : undefined,
      provider: typeof decoded.provider === "string" ? decoded.provider : undefined
    };
  }

  private async findUserOrThrow(identifier: string) {
    const raw = (identifier ?? "").trim();
    const handle = raw.replace(/^@/, "").toLowerCase();
    const [user] = await db
      .select()
      .from(userTable)
      .where(or(eq(userTable.id, raw), eq(userTable.handle, raw), eq(userTable.handle, handle)));
    if (!user) throw new NotFoundException(`User ${identifier} was not found`);
    return user;
  }

  private deriveSubscription(role: Role) {
    if (role === 'ADMIN') {
      return "VultStrike Operator";
    }
    if (role === 'MODERATOR') {
      return "VultStrike Sentinel";
    }
    return "VultStrike Plus";
  }

  private deriveRoleFromMode(mode: QueueMode) {
    switch (mode) {
      case 'ONE_V_ONE':
        return "Duelist";
      case 'THREE_V_THREE':
        return "Flex";
      default:
        return "Entry";
    }
  }

  private normalizeHandle(identifier: string) {
    const sanitized = identifier.toLowerCase().replace(/[^a-z0-9_]/g, "");
    return sanitized.length > 0 ? sanitized : `agent_${Date.now()}`;
  }

  private async ensureUniqueHandle(handle: string) {
    let candidate = handle;
    let counter = 0;
    // Check for uniqueness using Drizzle
    while (true) {
      const [existing] = await db.select().from(userTable).where(eq(userTable.handle, candidate));
      if (!existing) break;
      counter += 1;
      candidate = `${handle}_${counter}`;
    }
    return candidate;
  }

  private estimateEta(mode: QueueMode) {
    switch (mode) {
      case 'ONE_V_ONE':
        return 30;
      case 'THREE_V_THREE':
        return 75;
      default:
        return 45;
    }
  }

  private async fetchSteamProfile(steamId?: string) {
    const apiKey = process.env.STEAM_API_KEY;
    if (!steamId || !apiKey) return null;

    try {
      const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("steamids", steamId);
      const response = await fetch(url.toString());
      if (!response.ok) return null;
      const data = await response.json();
      const player = data?.response?.players?.[0];
      return player ?? null;
    } catch {
      return null;
    }
  }

  // Session management
  async getSessions(userId: string, currentSessionId?: string) {
    const foundUser = await this.findUserOrThrow(userId);
    
    const sessions = await db
      .select()
      .from(userSession)
      .where(eq(userSession.userId, foundUser.id))
      .orderBy(desc(userSession.lastActiveAt));
    
    return sessions.map(session => ({
      id: session.id,
      device: this.parseUserAgent(session.userAgent),
      location: session.city && session.country 
        ? `${session.city}, ${session.country}` 
        : session.country ?? 'Unknown',
      lastActive: this.formatLastActive(session.lastActiveAt),
      current: session.id === currentSessionId,
      createdAt: session.createdAt
    }));
  }

  async createSession(userId: string, userAgent: string | null, ipAddress: string | null) {
    const sessionId = crypto.randomUUID();
    
    // Try to get location from IP (simplified - in production use a proper geo service)
    const geoData = await this.getGeoFromIp(ipAddress);
    
    await db.insert(userSession).values({
      id: sessionId,
      userId,
      userAgent: userAgent?.slice(0, 512) ?? null,
      ipAddress: ipAddress?.slice(0, 64) ?? null,
      country: geoData?.country ?? null,
      city: geoData?.city ?? null,
      lastActiveAt: new Date(),
      createdAt: new Date()
    });
    
    return sessionId;
  }

  async updateSessionActivity(sessionId: string) {
    await db
      .update(userSession)
      .set({ lastActiveAt: new Date() })
      .where(eq(userSession.id, sessionId));
  }

  async terminateSession(userId: string, sessionId: string) {
    // Ensure user owns this session
    const [session] = await db
      .select()
      .from(userSession)
      .where(and(
        eq(userSession.id, sessionId),
        eq(userSession.userId, userId)
      ));
    
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    
    await db.delete(userSession).where(eq(userSession.id, sessionId));
    return { ok: true };
  }

  async terminateAllOtherSessions(userId: string, currentSessionId: string) {
    await db
      .delete(userSession)
      .where(and(
        eq(userSession.userId, userId),
        sql`${userSession.id} != ${currentSessionId}`
      ));
    return { ok: true };
  }

  private parseUserAgent(userAgent: string | null): string {
    if (!userAgent) return 'Unknown Device';
    
    const ua = userAgent.toLowerCase();
    
    // Detect OS
    let os = 'Unknown';
    if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
    else if (ua.includes('linux')) os = 'Linux';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
    
    // Detect browser
    let browser = 'Unknown';
    if (ua.includes('firefox')) browser = 'Firefox';
    else if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('chrome')) browser = 'Chrome';
    else if (ua.includes('safari')) browser = 'Safari';
    else if (ua.includes('opera') || ua.includes('opr/')) browser = 'Opera';
    
    return `${browser} • ${os}`;
  }

  private formatLastActive(date: Date | null): string {
    if (!date) return 'Unknown';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 5) return 'Active now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString();
  }

  private async getGeoFromIp(ip: string | null): Promise<{ country?: string; city?: string } | null> {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return { country: 'TR', city: 'Local' };
    }
    
    try {
      // Using ip-api.com free service (limited to 45 req/min)
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city`);
      if (!response.ok) return null;
      const data = await response.json();
      if (data.status === 'success') {
        return { country: data.countryCode, city: data.city };
      }
      return null;
    } catch {
      return null;
    }
  }
}
