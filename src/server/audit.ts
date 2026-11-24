import type { DbClient, Prisma } from "./db-client";

export type AuditEntry = {
  /** null = systemet själv (t.ex. automatisk tidsregistrering). */
  actorId: string | null;
  /** Versaler med understreck, t.ex. "PAYRATE_CHANGED", "LOGIN_FAILED". */
  action: string;
  entityType: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Skriver till den append-only revisionsloggen. Anropa inuti samma transaktion som
 * ändringen (skicka transaktionsklienten) så att logg och data aldrig kan skilja sig åt.
 * Skriv ALDRIG lösenord, token eller onödiga personuppgifter i before/after/metadata.
 */
export async function writeAudit(db: DbClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      metadata: entry.metadata,
    },
  });
}
