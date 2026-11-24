import type { DbClient } from "@/server/db-client";
import { writeAudit } from "@/server/audit";
import { type SessionContext, type UserRole, canUseAudience } from "@/domain/roles";
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from "./constants";
import { getDummyHash, verifyPassword } from "./password";

export type LoginResult =
  | { ok: true; user: { id: string; role: UserRole }; context: SessionContext }
  /** WRONG_AUDIENCE visas bara efter att lösenordet stämt: kontot är giltigt men får inte använda just den här inloggningen. */
  | { ok: false; reason: "INVALID" | "LOCKED" | "WRONG_AUDIENCE" };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Kontrollerar inloggningsuppgifter. Utan Next.js-beroenden så att den kan testas direkt
 * mot databasen. Anroparen skapar sessionen vid ok:true.
 *
 * - Två inloggningar: `audience` ADMIN kräver rollen ADMIN, EMPLOYEE kräver minst en aktiv anställning.
 * - Samma svar för okänd användare, fel lösenord och inaktiverat konto (ingen kontoavslöjande).
 * - Konto spärras LOCKOUT_MINUTES minuter efter MAX_FAILED_LOGINS felaktiga försök i rad.
 * - Alla utfall loggas i revisionsloggen (utan lösenord och utan angiven e-post).
 */
export async function authenticate(
  db: DbClient,
  input: { email: string; password: string; audience: SessionContext; ipAddress?: string | null },
  now: Date = new Date(),
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const user = await db.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    await verifyPassword(await getDummyHash(), input.password); // utjämna svarstid
    await writeAudit(db, {
      actorId: null,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user?.id,
      metadata: { reason: user ? "INACTIVE" : "UNKNOWN_USER", ip: input.ipAddress ?? null },
    });
    return { ok: false, reason: "INVALID" };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await writeAudit(db, {
      actorId: null,
      action: "LOGIN_BLOCKED_LOCKED",
      entityType: "User",
      entityId: user.id,
      metadata: { ip: input.ipAddress ?? null },
    });
    return { ok: false, reason: "LOCKED" };
  }

  const valid = await verifyPassword(user.passwordHash, input.password);

  if (!valid) {
    const { failedLoginCount } = await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const lock = failedLoginCount >= MAX_FAILED_LOGINS;
    if (lock) {
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000),
        },
      });
    }
    await writeAudit(db, {
      actorId: null,
      action: lock ? "LOGIN_LOCKED" : "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      metadata: { reason: "BAD_PASSWORD", ip: input.ipAddress ?? null },
    });
    return { ok: false, reason: lock ? "LOCKED" : "INVALID" };
  }

  // Lösenordet stämmer. Får kontot använda just den här inloggningen?
  const employmentCount = await db.employee.count({ where: { userId: user.id, status: "ACTIVE" } });
  if (!canUseAudience(user.role, input.audience, employmentCount)) {
    await writeAudit(db, {
      actorId: null,
      action: "LOGIN_WRONG_AUDIENCE",
      entityType: "User",
      entityId: user.id,
      metadata: { audience: input.audience, ip: input.ipAddress ?? null },
    });
    return { ok: false, reason: "WRONG_AUDIENCE" };
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  await writeAudit(db, {
    actorId: user.id,
    action: "LOGIN_SUCCESS",
    entityType: "User",
    entityId: user.id,
    metadata: { audience: input.audience, ip: input.ipAddress ?? null },
  });
  return { ok: true, user: { id: user.id, role: user.role }, context: input.audience };
}
