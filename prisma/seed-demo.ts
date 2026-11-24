/**
 * TESTDATA för lokal utveckling. Kör: npm run db:seed:demo
 *  - Vägrar köra i production eller mot annan databas än localhost.
 *  - Allt som skapas har isTestData = true och e-post på @demo.test (reserverad domän).
 *  - Skapar en testadministratör och sex anställda (3 Golfshop, 3 Bollplockare) med timlön och
 *    testschema för innevarande och nästa månad, så att Admin har något att titta på.
 *  - Lösenord: DEV_SEED_PASSWORD om satt, annars slumpas ett och skrivs ut en gång.
 *  - Idempotent: kör man den igen skapas inget dubbelt.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import type { WorkCategory } from "@/domain/roles";
import { dateStringToDbDate, stockholmYearMonth } from "@/domain/time";
import { hashPassword } from "@/server/auth/password";
import { createPrismaClient } from "@/server/db-client";
import { createDemoShifts } from "@/server/demo-data";
import { assertLocalDevelopment } from "@/server/local-guard";
import { changeHourlyRate } from "@/server/services/pay-rates";

const PEOPLE: { firstName: string; lastName: string; category: WorkCategory; rateKr: number }[] = [
  { firstName: "Erik", lastName: "Andersson", category: "GOLFSHOP", rateKr: 140 },
  { firstName: "Lisa", lastName: "Svensson", category: "GOLFSHOP", rateKr: 150 },
  { firstName: "Sara", lastName: "Lindqvist", category: "GOLFSHOP", rateKr: 145 },
  { firstName: "Oscar", lastName: "Nilsson", category: "BOLLPLOCKARE", rateKr: 140 },
  { firstName: "Emma", lastName: "Karlsson", category: "BOLLPLOCKARE", rateKr: 135 },
  { firstName: "Viktor", lastName: "Holm", category: "BOLLPLOCKARE", rateKr: 140 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL saknas.");
  assertLocalDevelopment(url);

  const generated = !process.env.DEV_SEED_PASSWORD;
  const password = process.env.DEV_SEED_PASSWORD ?? randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(password);
  const db = createPrismaClient(url);
  const year = stockholmYearMonth(new Date()).year;

  try {
    const admin =
      (await db.user.findUnique({ where: { email: "admin@demo.test" } })) ??
      (await db.user.create({
        data: { email: "admin@demo.test", name: "Anna Admin", passwordHash, role: "ADMIN", isTestData: true },
      }));

    const emails: string[] = ["admin@demo.test"];
    for (const [i, p] of PEOPLE.entries()) {
      const email = `${p.firstName}.${p.lastName}@demo.test`.toLowerCase();
      emails.push(email);
      const user =
        (await db.user.findUnique({ where: { email } })) ??
        (await db.user.create({ data: { email, passwordHash, role: p.category, isTestData: true } }));
      const employee =
        (await db.employee.findFirst({ where: { userId: user.id, category: p.category } })) ??
        (await db.employee.create({
          data: {
            userId: user.id,
            firstName: p.firstName,
            lastName: p.lastName,
            category: p.category,
            employmentStartDate: dateStringToDbDate(`${year}-01-01`),
            isTestData: true,
          },
        }));

      if ((await db.payRate.count({ where: { employeeId: employee.id } })) === 0) {
        await changeHourlyRate(db, { id: admin.id, role: "ADMIN" }, {
          employeeId: employee.id,
          hourlyRateOre: p.rateKr * 100,
          effectiveFrom: `${year}-01-01`,
          reason: "Testdata",
        });
      }
      await createDemoShifts(db, { employeeId: employee.id, category: p.category, createdById: admin.id, index: i });
    }

    console.log("\nTestdata klar (isTestData = true). Inloggningar (alla @demo.test):");
    for (const email of emails) console.log(`  ${email}`);
    console.log(generated ? `\nLösenord (visas bara nu): ${password}\n` : "\nLösenord: värdet i DEV_SEED_PASSWORD\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
