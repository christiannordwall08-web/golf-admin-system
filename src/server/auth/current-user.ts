import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { type Permission, type WorkCategory, can, homeFor } from "@/domain/roles";
import { getDb } from "@/server/db";
import { ForbiddenError, UnauthenticatedError } from "@/server/errors";
import { readSessionToken } from "./session-cookie";
import { type SessionUser, validateSession } from "./session-store";

/**
 * DATA ACCESS LAYER för autentisering. Alla sidor, layouts, Server Actions och Route Handlers
 * hämtar användaren HÄR – aldrig genom att lita på cookies, URL:er eller formulärfält.
 * proxy.ts gör bara en optimistisk kontroll; den här filen är den riktiga kontrollen.
 *
 * TVÅ INLOGGNINGAR: en session är antingen en ADMIN-session eller en EMPLOYEE-session och kan
 * bara använda den egna panelen, även om samma person har båda sorters åtkomst.
 */

/** Aktuell användare (cachas under ett och samma anrop). null = ej inloggad. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  return validateSession(getDb(), token);
});

/** Sessionens egen startsida. */
export function homeOf(session: SessionUser): string {
  return homeFor(session.context, session.user.primaryCategory);
}

/** För sidor/layouts: skickar ej inloggade till inloggningsvalet. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  return session;
}

/** Adminpanelen: kräver en ADMIN-session. Anställdsession studsas till sin egen startsida. */
export async function requireAdminArea(): Promise<SessionUser> {
  const session = await requireUser();
  if (session.context !== "ADMIN") redirect(homeOf(session));
  return session;
}

/**
 * Anställdpanelen för en arbetskategori: kräver en EMPLOYEE-session OCH en aktiv anställning i just
 * den kategorin. Returnerar den anställning (`employee`) som panelen visar data för.
 */
export async function requireEmployeeArea(
  category: WorkCategory,
): Promise<{ session: SessionUser; employee: { id: string; category: WorkCategory } }> {
  const session = await requireUser();
  if (session.context !== "EMPLOYEE") redirect(homeOf(session));
  const employee = session.user.employments.find((e) => e.category === category);
  if (!employee) redirect(homeOf(session));
  return { session, employee };
}

/**
 * Den samlade anställdvyn (`/anstalld`) för den som jobbar på båda ställena. Har man bara en arbetsplats
 * skickas man till den arbetsplatsens egen panel.
 */
export async function requireCombinedEmployeeArea(): Promise<SessionUser> {
  const session = await requireUser();
  if (session.context !== "EMPLOYEE") redirect(homeOf(session));
  if (session.user.employments.length < 2) redirect(homeOf(session));
  return session;
}

/**
 * För Server Actions och Route Handlers: kastar i stället för att omdirigera, så att
 * ett API-anrop aldrig kan lyckas utan behörighet. Behörighet följer SESSIONENS roll.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) throw new UnauthenticatedError();
  if (!can(session.user.actingRole, permission)) throw new ForbiddenError();
  return session;
}

/** Aktören (för tjänster och frågor) från sessionen: `role` är sessionens roll, inte kontots. */
export function toActor(session: SessionUser): { id: string; role: SessionUser["user"]["actingRole"] } {
  return { id: session.user.id, role: session.user.actingRole };
}
