/**
 * Skydd för skript som skapar test-/importdata: de får bara köras lokalt i utveckling.
 * Kastar fel i production och mot en databas som inte är lokal.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertLocalDevelopment(databaseUrl: string, env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production") throw new Error("Testdata/import får inte köras i production.");
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL är ogiltig.");
  }
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Vägrar köra mot icke-lokal databas (${host}).`);
}
