/**
 * TESTDATA för lokal utveckling. Kör: npm run db:seed:demo
 *  - Vägrar köra i production eller mot annan databas än localhost.
 *  - Allt som skapas har isTestData = true och e-post på @demo.test (reserverad domän).
 *  - Lösenord: DEV_SEED_PASSWORD om satt, annars slumpas ett och skrivs ut en gång.
 *  - Idempotent: kör man den igen skapas inget dubbelt.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import type { WorkCategory } from "@/domain/roles";
import { dateStringToDbDate, localToInstant, stockholmDateOf } from "@/domain/time";
import { hashPassword } from "@/server/auth/password";
import { createPrismaClient } from "@/server/db-client";
import { changeHourlyRate } from "@/server/services/pay-rates";

const PEOPLE: { firstName: string; lastName: string; category: WorkCategory; rateKr: number }[] = [
  { firstName: "Erik", lastName: "Andersson", category: "GOLFSHOP", rateKr: 140 },
  { firstName: "Lisa", lastName: "Svensson", category: "GOLFSHOP", rateKr: 150 },
  { firstName: "Oscar", lastName: "Nilsson", category: "BOLLPLOCKARE", rateKr: 140 },
  { firstName: "Emma", lastName: "Karlsson", category: "BOLLPLOCKARE", rateKr: 140 },
];

// Exemplen ur specen: lördag 28 och söndag 29 november 2026.
const SHIFTS = [
  { who: "Erik Andersson", date: "2026-11-28", from: "09:00", to: "13:00" },
  { who: "Lisa Svensson", date: "2026-11-28", from: "13:00", to: "17:00" },
  { who: "Oscar Nilsson", date: "2026-11-29", from: "10:00", to: "15:00" },
  { who: "Emma Karlsson", date: "2026-11-29", from: "12:00", to: "16:00" },
];

function assertLocalDevelopment(url: string) {
  if (process.env.NODE_ENV === "production") throw new Error("Testdata får inte skapas i production.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Vägrar skapa testdata mot icke-lokal databas (${host}).`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL saknas.");
  assertLocalDevelopment(url);

  const generated = !process.env.DEV_SEED_PASSWORD;
  const password = process.env.DEV_SEED_PASSWORD ?? randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(password);
  const db = createPrismaClient(url);

  try {
    const admin =
      (await db.user.findUnique({ where: { email: "admin@demo.test" } })) ??
      (await db.user.create({
        data: { email: "admin@demo.test", name: "Anna Admin", passwordHash, role: "ADMIN", isTestData: true },
      }));

    const employees = new Map<string, { id: string }>();
    for (const p of PEOPLE) {
      const email = `${p.firstName}.${p.lastName}@demo.test`.toLowerCase();
      let user = await db.user.findUnique({ where: { email } });
      user ??= await db.user.create({
        data: { email, passwordHash, role: p.category, isTestData: true },
      });
      const employee =
        (await db.employee.findUnique({ where: { userId: user.id } })) ??
        (await db.employee.create({
          data: {
            userId: user.id,
            firstName: p.firstName,
            lastName: p.lastName,
            category: p.category,
            employmentStartDate: dateStringToDbDate("2026-01-01"),
            isTestData: true,
          },
        }));
      employees.set(`${p.firstName} ${p.lastName}`, employee);

      if ((await db.payRate.count({ where: { employeeId: employee.id } })) === 0) {
        await changeHourlyRate(db, { id: admin.id, role: "ADMIN" }, {
          employeeId: employee.id,
          hourlyRateOre: p.rateKr * 100,
          effectiveFrom: "2026-01-01",
          reason: "Testdata",
        });
      }
    }

    for (const s of SHIFTS) {
      const employee = employees.get(s.who)!;
      const category = PEOPLE.find((p) => `${p.firstName} ${p.lastName}` === s.who)!.category;
      const startsAt = localToInstant(s.date, s.from);
      const schedule = await db.schedule.upsert({
        where: { category_year_month: { category, year: 2026, month: 11 } },
        create: { category, year: 2026, month: 11 },
        update: {},
      });
      const exists = await db.shift.findFirst({ where: { assignedEmployeeId: employee.id, startsAt } });
      if (!exists) {
        const shift = await db.shift.create({
          data: {
            scheduleId: schedule.id,
            category,
            assignedEmployeeId: employee.id,
            originalEmployeeId: employee.id,
            startsAt,
            endsAt: localToInstant(s.date, s.to),
            localDate: dateStringToDbDate(stockholmDateOf(startsAt)),
            createdById: admin.id,
          },
        });
        await db.shiftAssignmentHistory.create({
          data: { shiftId: shift.id, toEmployeeId: employee.id, reason: "INITIAL", changedById: admin.id },
        });
      }
    }

    console.log("\nTestdata klar (isTestData = true). Inloggningar:");
    for (const email of ["admin@demo.test", ...PEOPLE.map((p) => `${p.firstName}.${p.lastName}@demo.test`.toLowerCase())]) {
      console.log(`  ${email}`);
    }
    console.log(generated ? `\nLösenord (visas bara nu): ${password}\n` : "\nLösenord: värdet i DEV_SEED_PASSWORD\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
