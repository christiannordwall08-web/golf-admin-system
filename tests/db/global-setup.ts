import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Startar en engångs-PostgreSQL (aldrig utvecklingsdatabasen) och kör ALLA migrationer,
 * så att testerna körs mot exakt det schema och de constraints som produktionen får.
 */
export default async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "golf-test-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "golf",
    password: "golf",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("golf_test");

  const url = `postgresql://golf:golf@localhost:${port}/golf_test`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url, CHECKPOINT_DISABLE: "1" },
    stdio: "pipe",
  });
  process.env.TEST_DATABASE_URL = url;

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
