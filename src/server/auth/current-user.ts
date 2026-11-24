import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { type Permission, ROLE_HOME, type UserRole, can } from "@/domain/roles";
import { getDb } from "@/server/db";
import { ForbiddenError, UnauthenticatedError } from "@/server/errors";
import { readSessionToken } from "./session-cookie";
import { type SessionUser, validateSession } from "./session-store";

/**
 * DATA ACCESS LAYER för autentisering. Alla sidor, layouts, Server Actions och Route Handlers
 * hämtar användaren HÄR – aldrig genom att lita på cookies, URL:er eller formulärfält.
 * proxy.ts gör bara en snabb, optimistisk kontroll; den här filen är den riktiga kontrollen.
 */

/** Aktuell användare (cachas under ett och samma anrop). null = ej inloggad. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  return validateSession(getDb(), token);
});

/** För sidor/layouts: skickar ej inloggade till /login. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  return session;
}

/** För layouts: fel roll skickas till sin egen startsida (URL-ändringar ger aldrig åtkomst). */
export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const session = await requireUser();
  if (!roles.includes(session.user.role)) redirect(ROLE_HOME[session.user.role]);
  return session;
}

/**
 * För Server Actions och Route Handlers: kastar i stället för att omdirigera, så att
 * ett API-anrop aldrig kan lyckas utan behörighet.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) throw new UnauthenticatedError();
  if (!can(session.user.role, permission)) throw new ForbiddenError();
  return session;
}
