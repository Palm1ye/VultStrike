import { ForbiddenException } from "@nestjs/common";
import { db } from "../drizzle/client";
import { user as userTable } from "../drizzle/schema";
import { eq } from "drizzle-orm";

type BanAwareUser = {
  id: string;
  banned?: boolean | null;
  banReason?: string | null;
  banUntil?: Date | null;
};

export async function assertUserNotBanned(user: BanAwareUser) {
  if (!user?.banned) return;

  if (user.banUntil && new Date(user.banUntil).getTime() <= Date.now()) {
    await db
      .update(userTable)
      .set({ banned: false, banReason: null, banUntil: null })
      .where(eq(userTable.id, user.id));
    return;
  }

  const reason = user.banReason ? ` (${user.banReason})` : "";
  throw new ForbiddenException(`User is banned${reason}`);
}
