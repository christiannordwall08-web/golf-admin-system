import "server-only";
import { CATEGORY_HOME, COMBINED_HOME, type SessionContext, type WorkCategory } from "@/domain/roles";
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
  const categories: WorkCategory[] =
    mode === "admin" ? [] : mode === "alla" ? ["GOLFSHOP", "BOLLPLOCKARE"] : [mode === "golfshop" ? "GOLFSHOP" : "BOLLPLOCKARE"];

  // Anställd-läget kräver anställning på de ställen som valts ("alla" = båda).
  if (categories.length > 0 && (await db.employee.count({ where: { userId, category: { in: categories }, status: "ACTIVE" } })) < categories.length) return null;

  // Byt panel rent: avsluta tidigare session innan den nya skapas.
  await revokeSession(db, await readSessionToken());
  await clearSessionCookie();
  const { token, expiresAt } = await createSession(db, userId, context, { userAgent: "dev-preview" });
  await setSessionCookie(token, expiresAt);
  return mode === "admin" ? "/admin" : mode === "alla" ? COMBINED_HOME : CATEGORY_HOME[categories[0]];
}
