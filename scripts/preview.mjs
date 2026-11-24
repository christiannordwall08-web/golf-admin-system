// Startar allt som behövs för att titta på appen lokalt UTAN inloggning:
// lokal PostgreSQL, migrationer, data och utvecklingsservern i förhandsvisningsläge.
//  - Finns egna schemafiler i .local/*.json importeras de (riktiga personer/pass) och skendata hoppas över.
//  - Annars läggs påhittad testdata in (npm run db:seed:demo).
// Endast för utveckling. Kör: npm run preview   (Ctrl+C stoppar allt)
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";

const DB_URL = "postgresql://golf:golf@localhost:5433/golf_admin";
const env = { ...process.env, DATABASE_URL: DB_URL };

function run(label, cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...env, ...extraEnv }, shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\n${label} misslyckades.`);
    cleanup(1);
  }
}

let db;
let app;
function cleanup(code = 0) {
  app?.kill("SIGINT");
  db?.kill("SIGINT");
  setTimeout(() => process.exit(code), 1500);
}
process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

console.log("1/4  Startar lokal databas ...");
db = spawn(process.execPath, ["scripts/dev-db.mjs"], { env, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  db.once("exit", (c) => reject(new Error(`Databasen avslutades (kod ${c}). Körs den redan i en annan terminal? Stoppa den först.`)));
  db.stdout.on("data", (chunk) => {
    if (String(chunk).includes("PostgreSQL kör")) resolve();
  });
}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});

console.log("2/4  Skapar tabeller ...");
run("Migrering", "npx", ["prisma", "migrate", "deploy"], { CHECKPOINT_DISABLE: "1" });

const localFiles = existsSync(".local") ? readdirSync(".local").filter((f) => f.endsWith(".json")).sort() : [];
if (localFiles.length > 0) {
  console.log(`3/4  Importerar egen data (${localFiles.length} fil(er) i .local/) och hoppar över skendata ...`);
  for (const f of localFiles) run(`Import av ${f}`, "npx", ["tsx", "prisma/import-schedule.ts", `.local/${f}`]);
} else {
  console.log("3/4  Lägger in påhittad testdata ...");
  // Lösenordet behövs inte i förhandsvisning (ingen inloggning), så ett slumpat kastas.
  run("Testdata", "npx", ["tsx", "prisma/seed-demo.ts"], { DEV_SEED_PASSWORD: randomBytes(12).toString("base64url") });
}

console.log("4/4  Startar appen i förhandsvisningsläge ...\n");
app = spawn("npx", ["next", "dev"], {
  env: { ...env, DEV_PREVIEW: "1", PREVIEW_DEMO_DATA: localFiles.length > 0 ? "0" : "1" },
  stdio: "inherit",
  shell: process.platform === "win32",
});
app.on("exit", (c) => cleanup(c ?? 0));
