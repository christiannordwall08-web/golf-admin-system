// Startar en lokal PostgreSQL 17 utan Docker/installation (npm-paketet embedded-postgres).
// Endast för UTVECKLING. Produktion ska använda en hanterad Postgres med backuper.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const DATA_DIR = resolve(process.env.DEV_DB_DIR ?? ".pgdata");
const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const USER = "golf";
const PASSWORD = "golf";
const DATABASE = "golf_admin";

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  initdbFlags: ["--encoding=UTF8"],
  onLog: () => {},
  onError: (e) => console.error(String(e)),
});

if (!existsSync(join(DATA_DIR, "PG_VERSION"))) {
  console.log(`Initierar ny databas i ${DATA_DIR} ...`);
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase(DATABASE);
  console.log(`Skapade databasen "${DATABASE}".`);
} catch {
  // finns redan
}

console.log(`\nPostgreSQL kör. Lägg i .env:\n  DATABASE_URL="postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}"\n`);
console.log("Tryck Ctrl+C för att stoppa.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
