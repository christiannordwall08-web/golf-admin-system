import { randomInt } from "node:crypto";
import { z } from "zod";
import { type WorkCategory, can } from "@/domain/roles";
import { writeAudit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { revokeAllUserSessions } from "@/server/auth/session-store";
import type { PrismaClient } from "@/server/db-client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { Actor } from "./pay-rates";

/**
 * Admin skapar konton för personal: för- och efternamn, e-postadress och en personlig kod som admin delar ut.
 * Koden visas EN gång (den lagras bara som Argon2id-hash) och används som lösenord i den vanliga inloggningen.
 * Ingen parallell inloggning finns: samma sessionshantering och samma kontroller som för alla andra.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // utan 0/O/1/I för att undvika förväxling vid utdelning

/** Slumpad personlig kod, t.ex. "K7QF-M2XP-9WTD" (12 tecken ≈ 60 bitar). */
export function generatePersonalCode(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join("")).join("-");
}

const schema = z.object({
  firstName: z.string().trim().min(1, "Ange förnamn.").max(80),
  lastName: z.string().trim().min(1, "Ange efternamn.").max(80),
  email: z.string().trim().toLowerCase().email("Ange en giltig e-postadress.").max(254),
  category: z.enum(["GOLFSHOP", "BOLLPLOCKARE"]),
});

export async function createEmployeeAccount(
  db: PrismaClient,
  actor: Actor,
  raw: { firstName: string; lastName: string; email: string; category: WorkCategory },
): Promise<{ employeeId: string; userId: string; code: string }> {
  if (!can(actor.role, "employees:write")) throw new ForbiddenError("Endast Admin får skapa konton.");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter.");
  const d = parsed.data;
  if (await db.user.findUnique({ where: { email: d.email }, select: { id: true } })) {
    throw new ValidationError("Det finns redan ett konto med den e-postadressen.");
  }
  const code = generatePersonalCode();
  const passwordHash = await hashPassword(code);
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: d.email, passwordHash, role: d.category } });
    const employee = await tx.employee.create({ data: { userId: user.id, firstName: d.firstName, lastName: d.lastName, category: d.category, email: d.email } });
    await writeAudit(tx, { actorId: actor.id, action: "EMPLOYEE_ACCOUNT_CREATED", entityType: "Employee", entityId: employee.id, after: { category: d.category } });
    return { employeeId: employee.id, userId: user.id, code };
  });
}

/** Ny personlig kod (om den glömts eller röjts). Alla pågående inloggningar för kontot avslutas. */
export async function resetPersonalCode(db: PrismaClient, actor: Actor, employeeId: string): Promise<{ code: string }> {
  if (!can(actor.role, "employees:write")) throw new ForbiddenError("Endast Admin får ändra konton.");
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
  if (!e) throw new NotFoundError("Personen finns inte.");
  if (!e.userId) throw new ValidationError("Personen har inget konto än.");
  const code = generatePersonalCode();
  const passwordHash = await hashPassword(code);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: e.userId! }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    await revokeAllUserSessions(tx, e.userId!);
    await writeAudit(tx, { actorId: actor.id, action: "PERSONAL_CODE_RESET", entityType: "Employee", entityId: employeeId });
  });
  return { code };
}
