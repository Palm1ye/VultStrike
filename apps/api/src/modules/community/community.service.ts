import { Injectable } from "@nestjs/common";
import { db } from "../../drizzle/client";
import { user as userTable, match as matchTable, matchParticipant, queueTicket } from "../../drizzle/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { assertUserNotBanned } from "../../utils/ban";

export type ShoutMessage = {
  id: string;
  message: string;
  createdAt: string;
  user: {
    id: string;
    handle: string;
    displayName: string;
    steamDisplayName: string | null;
    steamId?: string | null;
  };
};

export type LiveMatch = {
  id: string;
  teams: string;
  map: string;
  mode: string;
  score: string;
  state: string;
  latency: string;
};

export type LeaderboardEntry = {
  player: string;
  displayName?: string;
  handle?: string;
  steamDisplayName?: string;
  tier: string;
  mmr: number;
  streak: number;
  kdr: number;
  trend: string;
};

export type CommunityStats = {
  activeMatches: number;
  activePlayers: number;
  queueingPlayers: number;
  connectedPlayers: number;
};

export type CommunityTotals = {
  totalMatches: number;
  totalUsers: number;
};

// In-memory shoutbox storage (can be replaced with database later)
const shoutboxMessages: ShoutMessage[] = [
  {
    id: "1",
    message: "Welcome to VultStrike Arena!",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    user: {
      id: "system",
      handle: "system",
      displayName: "System",
      steamDisplayName: null,
    },
  },
];

@Injectable()
export class CommunityService {
  async getShoutboxMessages(limit = 30): Promise<ShoutMessage[]> {
    const messages = shoutboxMessages.slice(-limit);
    const enriched = await Promise.all(
      messages.map(async (msg) => {
        const resolvedDisplayName = this.resolveDisplayName(msg.user.displayName, msg.user.handle, msg.user.steamId);
        const nextUser = {
          ...msg.user,
          displayName: resolvedDisplayName
        };

        if (!msg.user.steamDisplayName && msg.user.steamId) {
          const steamDisplayName = await this.fetchSteamDisplayName(msg.user.steamId);
          if (steamDisplayName) {
            return {
              ...msg,
              user: { ...nextUser, steamDisplayName }
            };
          }
        }
        return { ...msg, user: nextUser };
      })
    );

    return enriched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async postShoutboxMessage(userId: string, message: string): Promise<ShoutMessage> {
    // Fetch user details
    const [user] = await db
      .select({
        id: userTable.id,
        handle: userTable.handle,
        displayName: userTable.displayName,
        steamId: userTable.steamId,
        banned: userTable.banned,
        banReason: userTable.banReason,
        banUntil: userTable.banUntil
      })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);

    if (!user) {
      throw new Error("User not found");
    }
    await assertUserNotBanned(user);

    const steamDisplayName = await this.fetchSteamDisplayName(user.steamId ?? undefined);
    const resolvedDisplayName = this.resolveDisplayName(user.displayName, user.handle, user.steamId);

    // Create new shout
    const newShout: ShoutMessage = {
      id: crypto.randomUUID(),
      message,
      createdAt: new Date().toISOString(),
      user: {
        id: user.id,
        handle: user.handle,
        displayName: resolvedDisplayName,
        steamDisplayName: steamDisplayName ?? null,
        steamId: user.steamId ?? null
      },
    };

    shoutboxMessages.push(newShout);

    // Keep only last 100 messages to prevent memory issues
    if (shoutboxMessages.length > 100) {
      shoutboxMessages.shift();
    }

    return newShout;
  }

  async getLiveMatches(): Promise<LiveMatch[]> {
    // Fetch active matches from database
    const matches = await db
      .select({
        id: matchTable.id,
        map: matchTable.map,
        mode: matchTable.mode,
        status: matchTable.status,
        lobbyCode: matchTable.lobbyCode,
        scoreAlpha: matchTable.scoreAlpha,
        scoreBravo: matchTable.scoreBravo,
        currentRound: matchTable.currentRound,
        createdAt: matchTable.createdAt,
      })
      .from(matchTable)
      .where(sql`${matchTable.status} IN ('PENDING', 'IN_PROGRESS')`)
      .orderBy(desc(matchTable.createdAt));

    // For each match, fetch participants with display names
    const result: LiveMatch[] = [];
    for (const match of matches) {
      const participants = await db
        .select({
          team: matchParticipant.team,
          handle: userTable.handle,
          displayName: userTable.displayName,
          steamId: userTable.steamId,
        })
        .from(matchParticipant)
        .leftJoin(userTable, eq(matchParticipant.userId, userTable.id))
        .where(eq(matchParticipant.matchId, match.id));

      const getPlayerName = (p: typeof participants[0]) => {
        // Priority: displayName > handle (steamDisplayName not in schema)
        if (p.displayName && p.displayName !== p.steamId) return p.displayName;
        return p.handle || "Unknown";
      };

      const alphaPlayers = participants.filter((p) => p.team === "ALPHA").map(getPlayerName);
      const bravoPlayers = participants.filter((p) => p.team === "BRAVO").map(getPlayerName);

      const modeLabel = match.mode === "ONE_V_ONE" ? "1v1" : match.mode === "THREE_V_THREE" ? "3v3" : "2v2";
      
      const teamsText = alphaPlayers.length > 0 || bravoPlayers.length > 0
        ? `${alphaPlayers.join(" / ")} vs ${bravoPlayers.join(" / ")}`
        : "Waiting for players...";

      result.push({
        id: match.lobbyCode || `VS-${match.id.slice(-4)}`,
        teams: teamsText,
        map: match.map || "TBD",
        mode: modeLabel,
        score: `${match.scoreAlpha ?? 0} : ${match.scoreBravo ?? 0}`,
        state: match.status === "PENDING" || (match.currentRound ?? 0) === 0 ? "Warmup" : "Live",
        latency: `${Math.floor(Math.random() * 30 + 20)}ms`,
      });
    }

    return result;
  }

  async getStats(): Promise<CommunityStats> {
    const activeMatches = await db
      .select({ id: matchTable.id })
      .from(matchTable)
      .where(inArray(matchTable.status, ["PENDING", "IN_PROGRESS"]));

    const activeMatchIds = activeMatches.map((m) => m.id);

    let activePlayers = 0;
    let connectedPlayers = 0;
    if (activeMatchIds.length > 0) {
      const participants = await db
        .select({
          userId: matchParticipant.userId,
          connected: matchParticipant.connected
        })
        .from(matchParticipant)
        .where(inArray(matchParticipant.matchId, activeMatchIds));

      const uniquePlayers = new Set(participants.map((p) => p.userId));
      activePlayers = uniquePlayers.size;

      const connectedSet = new Set(
        participants.filter((p) => p.connected).map((p) => p.userId)
      );
      connectedPlayers = connectedSet.size;
    }

    const queued = await db
      .select({ userId: queueTicket.userId })
      .from(queueTicket)
      .where(eq(queueTicket.status, "ENQUEUED"));

    const queueingPlayers = new Set(queued.map((q) => q.userId)).size;

    return {
      activeMatches: activeMatches.length,
      activePlayers,
      queueingPlayers,
      connectedPlayers
    };
  }

  async getTotals(): Promise<CommunityTotals> {
    const [{ count: totalUsers }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userTable);

    // "Total matches" refers to matches that have completed.
    const [{ count: totalMatches }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(matchTable)
      .where(
        sql`${matchTable.status} = 'FINISHED'
            and ${matchTable.serverStatus} is distinct from 'FAILED'
            and (${matchTable.serverError} is null or ${matchTable.serverError} not like 'UNRATED:%')`
      );

    return {
      totalMatches: Number(totalMatches ?? 0),
      totalUsers: Number(totalUsers ?? 0)
    };
  }

  private resolveDisplayName(displayName?: string | null, handle?: string | null, steamId?: string | null) {
    if (displayName && steamId && displayName === steamId) {
      return handle ?? displayName;
    }
    if (displayName && /^\d{8,}$/.test(displayName)) {
      return handle ?? displayName;
    }
    return displayName || handle || "player";
  }

  private async fetchSteamDisplayName(steamId?: string) {
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
      return player?.personaname ?? null;
    } catch {
      return null;
    }
  }

  async getLeaderboard(mode?: string, limit = 10): Promise<LeaderboardEntry[]> {
    // Fetch users ordered by MMR based on mode
    let orderColumn = sql`${userTable.mmr2v2}`;
    if (mode === "ONE_V_ONE" || mode === "1v1") {
      orderColumn = sql`${userTable.mmr1v1}`;
    } else if (mode === "THREE_V_THREE" || mode === "3v3") {
      orderColumn = sql`${userTable.mmr3v3}`;
    }

    const users = await db
      .select({
        id: userTable.id,
        handle: userTable.handle,
        displayName: userTable.displayName,
        role: userTable.role,
        mmr1v1: userTable.mmr1v1,
        mmr2v2: userTable.mmr2v2,
        mmr3v3: userTable.mmr3v3,
        trustScore: userTable.trustScore,
      })
      .from(userTable)
      .orderBy(desc(orderColumn))
      .limit(Math.max(limit * 3, limit + 10));

    const hiddenHandles = new Set([
      "admin",
      "guest",
      "vs-test-bot",
      "vstestbot",
      "vs_test_bot",
      "vs test bot"
    ]);

    const filtered = users.filter((user) => {
      const normalized = (user.handle ?? "").trim().toLowerCase();
      if (hiddenHandles.has(normalized)) return false;
      return true;
    });

    return filtered.slice(0, limit).map((user) => {
      const mmr = mode === "ONE_V_ONE" || mode === "1v1"
        ? user.mmr1v1
        : mode === "THREE_V_THREE" || mode === "3v3"
        ? user.mmr3v3
        : user.mmr2v2;

      const resolvedMmr = typeof mmr === "number" ? mmr : 0;
      const displayName = user.displayName || user.handle;
      const handle = user.handle;

      return {
        player: displayName,
        displayName: user.displayName || undefined,
        handle,
        tier: this.getTierFromMMR(resolvedMmr),
        mmr: resolvedMmr,
        streak: 0,
        kdr: 0,
        trend: "0",
      };
    });
  }

  private getTierFromMMR(mmr: number): string {
    if (mmr <= 0) return "Unranked";
    if (mmr >= 3500) return "Mythic Prime";
    if (mmr >= 3000) return "Mythic";
    if (mmr >= 2700) return "Radiant";
    if (mmr >= 2400) return "Immortal";
    if (mmr >= 2100) return "Ascendant";
    if (mmr >= 1800) return "Diamond";
    if (mmr >= 1500) return "Platinum";
    if (mmr >= 1200) return "Gold";
    if (mmr >= 900) return "Silver";
    return "Bronze";
  }
}
