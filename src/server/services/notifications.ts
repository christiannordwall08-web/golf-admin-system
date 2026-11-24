import { safeInternalPath } from "@/domain/roles";
import type { NotificationType } from "@/generated/prisma/enums";
import type { DbClient } from "@/server/db-client";

/**
 * Notiser i appen. Varje notis hör till EN användare (`userId`) och kan bara läsas och markeras av den användaren:
 * alla frågor och ändringar avgränsas med userId från sessionen, aldrig med ett id från klienten.
 * `linkPath` måste vara en intern sökväg (skydd mot öppen omdirigering), annars sparas ingen länk.
 */
export type NotificationInput = {
  userIds: readonly string[];
  type: NotificationType;
  title: string;
  body?: string | null;
  linkPath?: string | null;
  entityType?: string;
  entityId?: string;
};

/** Giltig intern länk eller null. Tillåter inte externa adresser, "//", backslash eller kontrolltecken. */
export function internalLinkOrNull(path: string | null | undefined): string | null {
  if (!path) return null;
  return safeInternalPath(path, "") || null;
}

/** Skapar en notis per mottagare (dubbletter av samma användare tas bort). Anropas inuti den ändrande transaktionen. */
export async function notify(db: DbClient, input: NotificationInput): Promise<number> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return 0;
  const linkPath = internalLinkOrNull(input.linkPath);
  const r = await db.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 1000) ?? null,
      linkPath,
      entityType: input.entityType,
      entityId: input.entityId,
    })),
  });
  return r.count;
}

/** Aktiva administratörer. Mottagare av begäranden som Admin ska ta ställning till. */
export async function adminUserIds(db: DbClient): Promise<string[]> {
  return (await db.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } })).map((u) => u.id);
}

/**
 * Mottagare av dagsavslut: administratörer som valts för det (`receivesDailyClosings`). Har ingen valts går det till
 * alla aktiva administratörer, så att ett avslut aldrig blir osynligt.
 */
export async function closingRecipientIds(db: DbClient): Promise<string[]> {
  const chosen = await db.user.findMany({ where: { role: "ADMIN", isActive: true, receivesDailyClosings: true }, select: { id: true } });
  return chosen.length > 0 ? chosen.map((u) => u.id) : adminUserIds(db);
}

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function listMyNotifications(db: DbClient, userId: string, limit = 50): Promise<NotificationRow[]> {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true, type: true, title: true, body: true, linkPath: true, readAt: true, createdAt: true },
  });
}

export async function countMyUnread(db: DbClient, userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

/** Markerar en egen notis som läst. Returnerar notisens länk, eller null om notisen inte är din (ingen skillnad mot att den saknas). */
export async function openMyNotification(
  db: DbClient,
  userId: string,
  id: string,
  now = new Date(),
): Promise<{ linkPath: string | null } | null> {
  const n = await db.notification.findFirst({ where: { id, userId }, select: { id: true, linkPath: true, readAt: true } });
  if (!n) return null;
  if (!n.readAt) await db.notification.update({ where: { id: n.id }, data: { readAt: now } });
  return { linkPath: internalLinkOrNull(n.linkPath) };
}

export async function markAllMineRead(db: DbClient, userId: string, now = new Date()): Promise<number> {
  const r = await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } });
  return r.count;
}
