/**
 * Importerar ett schema från en JSON-fil till den LOKALA utvecklingsdatabasen.
 * Kör: npm run db:import -- .local/golfshop-2026-11.json
 * Filerna ska ligga i .local/ (ignoreras av git). Vägrar köra i production eller mot icke-lokal databas.
 * Format: se src/server/schedule-import.ts (scheduleImportSchema).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createPrismaClient } from "@/server/db-client";
import { assertLocalDevelopment } from "@/server/local-guard";
import { importSchedule } from "@/server/schedule-import";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Ange en JSON-fil, t.ex. npm run db:import -- .local/golfshop-2026-11.json");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL saknas.");
  assertLocalDevelopment(url);

  const db = createPrismaClient(url);
  try {
    const r = await importSchedule(db, JSON.parse(readFileSync(file, "utf8")));
    console.log(`Import klar: ${file}`);
    console.log(`  Nya personer:   ${r.employeesCreated.join(", ") || "–"}`);
    console.log(`  Fanns redan:    ${r.employeesExisting.join(", ") || "–"}`);
    console.log(`  Timlön satt:    ${r.ratesSet.join(", ") || "–"}${r.ratesCorrected.length ? `  (rättad: ${r.ratesCorrected.join(", ")})` : ""}`);
    console.log(`  Pass skapade:   ${r.shiftsCreated}  (hoppade över redan importerade: ${r.shiftsSkipped})`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
