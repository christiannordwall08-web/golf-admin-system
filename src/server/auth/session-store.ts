import { createHash, randomBytes } from "node:crypto";
import type { DbClient } from "@/server/db-client";
import { type SessionContext, type UserRole, type WorkCategory, actingRoleFor, primaryCategory } from "@/domain/roles";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_TOUCH_INTERVAL_MS } from "./constants";

/**
 * Databasbaserade sessioner. Webbläsaren får en slumpmässig token (256 bit). I databasen
 * sparas bara SHA-256 av den, så en läckt databas kan inte användas för att ta över sessioner.
 */

export type SessionUser = {
  sessionId: string;
  /** Vilken inloggning sessionen kommer från. Styr vilken panel och vilka behörigheter som gäller. */
  context: SessionContext;
  user: {
    id: string;
    email: string;
    /** Kontots åtkomstnivå (ADMIN får använda admininloggningen). Använd actingRole för behörighetskontroller. */
    role: UserRole;
    /** Rollen vars behörigheter gäller i DEN HÄR sessionen (ADMIN i adminsession, annars personalroll). */
    actingRole: UserRole;
    /** Visningsnamn: personalregistrets namn om personen är anställd, annars User.name. */
    displayName: string;
    firstName: string | null;
    /** Aktiva anställningar (en per arbetskategori). */
    employments: { id: string; category: WorkCategory }[];
    /** Främsta arbetsplats (för startsida och standardpanel). */
    primaryCategory: WorkCategory | null;
  };
};

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: DbClient,
  userId: string,
  context: SessionContext,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await db.session.create({
    data: {
      id: hashToken(token),
      userId,
      context,
      expiresAt,
      lastSeenAt: now,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
    },
  });
  return { token, expiresAt };
}

/** Returnerar användaren om token är giltig, annars null. Rensar utgångna sessioner. */
export async function validateSession(
  db: DbClient,
  token: string | undefined | null,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  if (!token) return null;
  const id = hashToken(token);
  const session = await db.session.findUnique({
    where: { id },
    include: {
      user: {
        include: {
          employees: {
            where: { status: "ACTIVE" },
            select: { id: true, firstName: true, lastName: true, category: true },
            orderBy: { category: "asc" },
          },
        },
      },
    },
  });
  if (!session) return null;

  const { user } = session;
  const idleExpired = now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS;
  // En session är bara giltig om kontot fortfarande får använda inloggningen den skapades med.
  const stillEligible =
    session.context === "ADMIN" ? user.role === "ADMIN" : user.employees.length > 0;
  if (session.expiresAt <= now || idleExpired || !user.isActive || !stillEligible) {
    await db.session.deleteMany({ where: { id } });
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id }, data: { lastSeenAt: now } });
  }

  const categories = user.employees.map((e) => e.category);
  const registryPerson = user.employees[0];
  return {
    sessionId: id,
    context: session.context,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      actingRole: actingRoleFor(session.context, categories),
      displayName: registryPerson ? `${registryPerson.firstName} ${registryPerson.lastName}`.trim() : (user.name ?? user.email),
      firstName: registryPerson ? registryPerson.firstName : (user.name?.split(" ")[0] ?? null),
      employments: user.employees.map((e) => ({ id: e.id, category: e.category })),
      primaryCategory: primaryCategory(user.role, categories),
    },
  };
}

export async function revokeSession(db: DbClient, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db.session.deleteMany({ where: { id: hashToken(token) } });
}

/** Loggar ut en användare överallt (t.ex. vid inaktivering eller lösenordsbyte). */
export async function revokeAllUserSessions(db: DbClient, userId: string): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { userId } });
  return count;
}

/** Underhåll: radera utgångna sessioner (kan köras av ett schemalagt jobb). */
export async function purgeExpiredSessions(db: DbClient, now: Date = new Date()): Promise<number> {
  const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MS);
  const { count } = await db.session.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { lastSeenAt: { lt: idleCutoff } }] },
  });
  return count;
}
