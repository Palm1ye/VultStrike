import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { db } from "../../drizzle/client";
import { party as partyTable, partyMember, user as userTable } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { assertUserNotBanned } from "../../utils/ban";

type PartyMemberRow = {
  userId: string;
  role: string | null;
  ready: boolean | null;
  joinedAt: Date | null;
  handle: string | null;
  displayName: string | null;
};

@Injectable()
export class PartyService {
  async createParty(userId: string, mode?: string, region?: string) {
    const [user] = await db.select().from(userTable).where(eq(userTable.id, userId));
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    await assertUserNotBanned(user);

    const existing = await this.getPartyByUser(userId);
    if (existing) return existing;

    const code = await this.generatePartyCode();
    const partyId = crypto.randomUUID();

    const normalizedMode = this.normalizeMode(mode);
    const normalizedRegion = region ? region.toUpperCase() : null;
    if (normalizedMode === "ONE_V_ONE") {
      throw new BadRequestException("Parties are not available for 1v1.");
    }

    const [created] = await db
      .insert(partyTable)
      .values({
        id: partyId,
        code,
        leaderUserId: userId,
        mode: normalizedMode,
        region: normalizedRegion,
        status: "OPEN"
      })
      .returning();

    await db.insert(partyMember).values({
      partyId,
      userId,
      role: "LEADER",
      ready: true
    });

    return this.getPartyById(created.id);
  }

  async joinParty(userId: string, code: string) {
    const [user] = await db.select().from(userTable).where(eq(userTable.id, userId));
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    await assertUserNotBanned(user);

    const partyRow = await this.getPartyByCode(code);
    if (!partyRow) throw new NotFoundException("Party not found");
    if (partyRow.status !== "OPEN") throw new BadRequestException("Party is closed");
    if (partyRow.mode === "ONE_V_ONE") {
      throw new BadRequestException("Parties are not available for 1v1.");
    }

    const existing = await db
      .select()
      .from(partyMember)
      .where(and(eq(partyMember.partyId, partyRow.id), eq(partyMember.userId, userId)));
    if (existing.length) return this.getPartyById(partyRow.id);

    const members = await this.getPartyMembers(partyRow.id);
    const maxSize = this.maxPartySize(partyRow.mode ?? undefined);
    if (members.length >= maxSize) {
      throw new BadRequestException("Party is full");
    }

    await db.insert(partyMember).values({
      partyId: partyRow.id,
      userId,
      role: "MEMBER",
      ready: false
    });

    return this.getPartyById(partyRow.id);
  }

  async leaveParty(userId: string) {
    const partyRow = await this.getPartyByUser(userId);
    if (!partyRow) throw new NotFoundException("User is not in a party");

    const members = await this.getPartyMembers(partyRow.id);
    const leaving = members.find(m => m.userId === userId);
    if (!leaving) throw new NotFoundException("User is not in this party");

    await db
      .delete(partyMember)
      .where(and(eq(partyMember.partyId, partyRow.id), eq(partyMember.userId, userId)));

    const remaining = members.filter(m => m.userId !== userId);
    if (remaining.length === 0) {
      await db.delete(partyTable).where(eq(partyTable.id, partyRow.id));
      return { ok: true, message: "Party closed" };
    }

    if (partyRow.leaderUserId === userId) {
      const nextLeader = remaining.sort((a, b) => new Date(a.joinedAt ?? 0).getTime() - new Date(b.joinedAt ?? 0).getTime())[0];
      await db
        .update(partyTable)
        .set({ leaderUserId: nextLeader.userId })
        .where(eq(partyTable.id, partyRow.id));

      await db
        .update(partyMember)
        .set({ role: "LEADER" })
        .where(and(eq(partyMember.partyId, partyRow.id), eq(partyMember.userId, nextLeader.userId)));
    }

    return this.getPartyById(partyRow.id);
  }

  async setReady(userId: string, ready: boolean) {
    const partyRow = await this.getPartyByUser(userId);
    if (!partyRow) throw new NotFoundException("User is not in a party");

    const [user] = await db.select().from(userTable).where(eq(userTable.id, userId));
    if (user) {
      await assertUserNotBanned(user);
    }

    await db
      .update(partyMember)
      .set({ ready })
      .where(and(eq(partyMember.partyId, partyRow.id), eq(partyMember.userId, userId)));

    return this.getPartyById(partyRow.id);
  }

  async getPartyById(partyId: string) {
    const [partyRow] = await db.select().from(partyTable).where(eq(partyTable.id, partyId));
    if (!partyRow) throw new NotFoundException("Party not found");
    const members = await this.getPartyMembers(partyId);
    return {
      ...partyRow,
      members
    };
  }

  async getPartyByUser(userId: string) {
    const [member] = await db.select().from(partyMember).where(eq(partyMember.userId, userId));
    if (!member) return null;
    return this.getPartyById(member.partyId);
  }

  async getPartyByCode(code: string) {
    const [partyRow] = await db
      .select()
      .from(partyTable)
      .where(eq(partyTable.code, code.trim().toUpperCase()));
    return partyRow ?? null;
  }

  async getPartyWithMembersByCode(code: string) {
    const partyRow = await this.getPartyByCode(code);
    if (!partyRow) return null;
    const members = await this.getPartyMembers(partyRow.id);
    return { party: partyRow, members };
  }

  private async getPartyMembers(partyId: string): Promise<PartyMemberRow[]> {
    return db
      .select({
        userId: partyMember.userId,
        role: partyMember.role,
        ready: partyMember.ready,
        joinedAt: partyMember.joinedAt,
        handle: userTable.handle,
        displayName: userTable.displayName
      })
      .from(partyMember)
      .leftJoin(userTable, eq(partyMember.userId, userTable.id))
      .where(eq(partyMember.partyId, partyId));
  }

  private maxPartySize(mode?: string) {
    if (!mode) return 3;
    const normalized = this.normalizeMode(mode);
    if (normalized === "ONE_V_ONE") return 1;
    if (normalized === "TWO_V_TWO") return 2;
    return 3;
  }

  private normalizeMode(mode?: string | null) {
    if (!mode) return null;
    const normalized = mode.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["1v1", "11", "onevone", "duel"].includes(normalized)) return "ONE_V_ONE";
    if (["2v2", "22", "twovtwo", "core"].includes(normalized)) return "TWO_V_TWO";
    if (["3v3", "33", "threevthree", "squad"].includes(normalized)) return "THREE_V_THREE";
    if (["onevone", "twovtwo", "threevthree"].includes(normalized)) return normalized.toUpperCase() as any;
    if (["one_v_one", "two_v_two", "three_v_three"].includes(normalized)) return normalized.toUpperCase() as any;
    return null;
  }

  private async generatePartyCode() {
    for (let i = 0; i < 10; i++) {
      const code = `P-${this.randomCode(8)}`;
      const [existing] = await db.select().from(partyTable).where(eq(partyTable.code, code));
      if (!existing) return code;
    }
    throw new Error("Failed to generate unique party code");
  }

  private randomCode(length: number) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  }
}
