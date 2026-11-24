import "server-only";
import { CATEGORY_HOME, type SessionContext, type WorkCategory } from "@/domain/roles";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { createSession, revokeSession } from "@/server/auth/session-store";
import type { PrismaClient } from "@/server/db-client";
import type { PreviewMode } from "@/server/dev-preview";

/**
 * Förhandsvisning: startar en vanlig session för testprofilen, som Admin eller som Anställd i en
 * arbetsplats. Returnerar sökvägen att skicka till, eller null om profilen saknar den anställningen.
 * Anropas bara efter att `isDevPreviewEnabled()` och `findPreviewProfile()` godkänt.
 */
export async function startPreviewSession(db: PrismaClient, userId: string, mode: PreviewMode): Promise<string | null> {
  const context: SessionContext = mode === "admin" ? "ADMIN" : "EMPLOYEE";
  const category: WorkCategory | null = mode === "admin" ? null : mode === "golfshop" ? "GOLFSHOP" : "BOLLPLOCKARE";

  if (category && !(await db.employee.count({ where: { userId, category, status: "ACTIVE" } }))) return null;

  // Byt panel rent: avsluta tidigare session innan den nya skapas.
  await revokeSession(db, await readSessionToken());
  await clearSessionCookie();
  const { token, expiresAt } = await createSession(db, userId, context, { userAgent: "dev-preview" });
  await setSessionCookie(token, expiresAt);
  return category ? CATEGORY_HOME[category] : "/admin";
}
