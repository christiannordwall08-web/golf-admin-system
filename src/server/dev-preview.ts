import type { WorkCategory } from "@/domain/roles";
import type { DbClient } from "@/server/db-client";

/**
 * FÖRHANDSVISNINGSLÄGE för lokal utveckling: gör att man kan titta på alla paneler utan lösenord.
 *
 * Säkerhetsmodell (alla villkor måste vara sanna):
 *  1. DEV_PREVIEW=1 sätts av `npm run preview` – aldrig i .env eller i drift.
 *  2. NODE_ENV === "development". `next build` / `next start` är alltid "production" ⇒ läget är då omöjligt att slå på.
 *  3. DATABASE_URL pekar på en lokal databas.
 *  4. Läget kan bara logga in som ett TESTKONTO (isTestData = true, e-post @demo.test) som skapats i förhandsvisningen.
 *     Det går aldrig att logga in som en riktig användare den vägen.
 * Förhandsvisning skapar en vanlig session (med rätt inloggningstyp), så alla roll- och behörighetskontroller gäller.
 */

/** Cookie som pekar ut förhandsvisningens testprofil. Det är ingen inloggning, bara ett val av testkonto. */
export const PREVIEW_COOKIE = "golf_dev_profile";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isDevPreviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.DEV_PREVIEW !== "1") return false;
  if (env.NODE_ENV !== "development") return false;
  if (!env.DATABASE_URL) return false;
  try {
    return LOCAL_HOSTS.has(new URL(env.DATABASE_URL).hostname);
  } catch {
    return false;
  }
}

/**
 * Skendata (påhittade personer och pass) i förhandsvisningen. `npm run preview` stänger av det (PREVIEW_DEMO_DATA=0)
 * när egen data finns i .local/, så att riktiga och påhittade personer aldrig blandas.
 */
export function isPreviewDemoData(env: Record<string, string | undefined> = process.env): boolean {
  return env.PREVIEW_DEMO_DATA !== "0";
}

export type PreviewMode = "admin" | WorkCategoryMode | "alla";
type WorkCategoryMode = Lowercase<WorkCategory>;

/** URL-segment -> läge ("admin" = adminpanelen, "alla" = anställd på båda ställena, annars anställd i den kategorin), annars null. */
export function modeFromSegment(segment: string): PreviewMode | null {
  const s = segment.toLowerCase();
  return s === "admin" || s === "golfshop" || s === "bollplockare" || s === "alla" ? s : null;
}

/** Testprofilen med givet id, eller null. Hittar aldrig en riktig användare. */
export async function findPreviewProfile(
  db: DbClient,
  userId: string | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!userId) return null;
  const user = await db.user.findFirst({
    where: { id: userId, isTestData: true, isActive: true, role: "ADMIN", email: { endsWith: "@demo.test" } },
    select: { id: true, name: true, email: true },
  });
  return user ? { id: user.id, name: user.name ?? user.email } : null;
}
