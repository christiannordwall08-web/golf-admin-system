import type { UserRole } from "@/domain/roles";
import type { DbClient } from "@/server/db-client";

/**
 * FÖRHANDSVISNINGSLÄGE för lokal utveckling: gör att man kan titta på alla rollers vyer utan lösenord.
 *
 * Säkerhetsmodell (alla villkor måste vara sanna):
 *  1. DEV_PREVIEW=1 sätts av `npm run preview` – aldrig i .env eller i drift.
 *  2. NODE_ENV === "development". `next build` / `next start` är alltid "production" ⇒ läget är då omöjligt att slå på.
 *  3. DATABASE_URL pekar på en lokal databas.
 *  4. Läget kan bara logga in som de fasta TESTKONTON som `npm run db:seed:demo` skapar (isTestData = true, @demo.test).
 *     Det går aldrig att logga in som en riktig användare den vägen.
 * Roll- och behörighetskontrollerna (`requireRole` m.fl.) är oförändrade: förhandsvisning skapar en vanlig session.
 */

export const PREVIEW_ACCOUNTS: Record<UserRole, string> = {
  ADMIN: "admin@demo.test",
  GOLFSHOP: "erik.andersson@demo.test",
  BOLLPLOCKARE: "oscar.nilsson@demo.test",
};

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

/** Testkontot för en roll, eller null om testdata saknas. Hittar aldrig en riktig användare. */
export async function findPreviewUser(db: DbClient, role: UserRole): Promise<{ id: string; role: UserRole } | null> {
  return db.user.findFirst({
    where: { email: PREVIEW_ACCOUNTS[role], role, isTestData: true, isActive: true },
    select: { id: true, role: true },
  });
}

/** URL-segment ("admin") -> roll, annars null. */
export function roleFromSegment(segment: string): UserRole | null {
  switch (segment.toLowerCase()) {
    case "admin":
      return "ADMIN";
    case "golfshop":
      return "GOLFSHOP";
    case "bollplockare":
      return "BOLLPLOCKARE";
    default:
      return null;
  }
}
