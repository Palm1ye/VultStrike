import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../drizzle/client";
import { user as userTable, userDrop } from "../../drizzle/schema";

type DropRarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";

type DropResult = {
  id: number;
  rarity: DropRarity;
  item: string;
  source: string;
  createdAt: string | null;
};

const DEFAULT_CASE_TYPE = "standard";

const CASES: Record<
  string,
  {
    cost: number;
    pool: Record<DropRarity, string[]>;
    weights: Record<DropRarity, number>;
  }
> = {
  standard: {
    cost: 250,
    weights: { COMMON: 0.7, RARE: 0.2, EPIC: 0.09, LEGENDARY: 0.01 },
    pool: {
      COMMON: ["Sticker Pack", "XP Boost (1h)", "Badge: Bronze"],
      RARE: ["Name Tag", "XP Boost (6h)", "Badge: Silver"],
      EPIC: ["Badge: Gold", "Loot Key", "Profile Border: Neon"],
      LEGENDARY: ["Case: Mythic", "Profile Theme: Mythic", "Loot Key x3"]
    }
  }
};

function rewardsEnabled(): boolean {
  return (process.env.REWARDS_ENABLED ?? "false").toLowerCase() === "true";
}

function rollRarity(weights: Record<DropRarity, number>): DropRarity {
  const entries = Object.entries(weights) as [DropRarity, number][];
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  const r = Math.random() * total;
  let cursor = 0;
  for (const [rarity, w] of entries) {
    cursor += w;
    if (r <= cursor) return rarity;
  }
  return "COMMON";
}

function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

@Injectable()
export class RewardsService {
  async me(userId: string) {
    if (!rewardsEnabled()) {
      return { ok: false, error: "Rewards disabled" as const };
    }

    const [userRow] = await db
      .select({ credits: userTable.credits })
      .from(userTable)
      .where(eq(userTable.id, userId));

    const credits = Number(userRow?.credits ?? 0);

    const drops = await db
      .select({
        id: userDrop.id,
        rarity: userDrop.rarity,
        item: userDrop.item,
        source: userDrop.source,
        createdAt: userDrop.createdAt
      })
      .from(userDrop)
      .where(eq(userDrop.userId, userId))
      .orderBy(desc(userDrop.id))
      .limit(20);

    return {
      ok: true as const,
      credits,
      drops: drops.map(
        (d): DropResult => ({
          id: d.id,
          rarity: d.rarity as DropRarity,
          item: d.item,
          source: d.source,
          createdAt: d.createdAt?.toISOString() ?? null
        })
      )
    };
  }

  async openCase(userId: string, caseTypeRaw?: string) {
    if (!rewardsEnabled()) {
      return { ok: false, error: "Rewards disabled" as const };
    }

    const caseType = (caseTypeRaw ?? DEFAULT_CASE_TYPE).trim().toLowerCase() || DEFAULT_CASE_TYPE;
    const config = CASES[caseType];
    if (!config) {
      return { ok: false, error: "Unknown case type" as const };
    }

    // Charge credits (atomic).
    const charged = await db
      .update(userTable)
      .set({
        credits: sql<number>`${userTable.credits} - ${config.cost}`
      })
      .where(and(eq(userTable.id, userId), sql`${userTable.credits} >= ${config.cost}`))
      .returning({ credits: userTable.credits });

    if (charged.length === 0) {
      return { ok: false, error: "Insufficient credits" as const, cost: config.cost };
    }

    const rarity = rollRarity(config.weights);
    const item = pickOne(config.pool[rarity]);

    try {
      const [created] = await db
        .insert(userDrop)
        .values({
          userId,
          source: "CASE_OPEN",
          rarity,
          item,
          meta: { caseType, cost: config.cost }
        })
        .returning();

      return {
        ok: true as const,
        credits: Number(charged[0]?.credits ?? 0),
        drop: {
          id: created?.id ?? null,
          rarity,
          item
        }
      };
    } catch (err) {
      // Best-effort refund if drop insert fails.
      try {
        await db
          .update(userTable)
          .set({ credits: sql<number>`${userTable.credits} + ${config.cost}` })
          .where(eq(userTable.id, userId));
      } catch {
        // Ignore refund failures; this should be very rare and requires manual reconciliation.
      }

      return { ok: false, error: "Failed to open case" as const };
    }
  }
}

