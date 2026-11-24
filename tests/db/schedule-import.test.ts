import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import { getPersonnelOverview } from "@/server/queries/personnel";
import { getScheduleMonth } from "@/server/queries/schedule";
import { type ScheduleImportInput, importSchedule } from "@/server/schedule-import";
import { resetDb, testDb } from "./helpers";

const db = testDb();
// Tisdag 24 nov 2026 kl 16.40 svensk tid.
const NOW = new Date("2026-11-24T15:40:00Z");

/** Påhittade personer med samma struktur som ett utskrivet schema: bara förnamn, handskrivet 11-15. */
const FILE: ScheduleImportInput = {
  category: "GOLFSHOP",
  employees: [
    { firstName: "Anna", hourlyRateKr: 150, rateFrom: "2026-01-01" },
    { firstName: "Bo", hourlyRateKr: 150, rateFrom: "2026-01-01" },
    { firstName: "Cia", hourlyRateKr: 150, rateFrom: "2026-01-01" },
    { firstName: "Dan", hourlyRateKr: 150, rateFrom: "2026-01-01" }, // inga pass
  ],
  shifts: [
    { employee: "Anna", date: "2026-11-01", from: "11:00", to: "15:00" },
    { employee: "Anna", date: "2026-11-08", from: "11:00", to: "15:00" },
    { employee: "Anna", date: "2026-11-21", from: "11:00", to: "15:00" },
    { employee: "Bo", date: "2026-11-07", from: "11:00", to: "15:00" },
    { employee: "Bo", date: "2026-11-22", from: "11:00", to: "15:00" },
    { employee: "Cia", date: "2026-11-16", from: "11:00", to: "15:00" },
    { employee: "Cia", date: "2026-11-23", from: "11:00", to: "15:00" },
    { employee: "Cia", date: "2026-11-28", from: "11:00", to: "15:00" }, // framtid
  ],
};

beforeEach(async () => {
  await resetDb(db);
});

async function admin() {
  const user = await db.user.findUniqueOrThrow({ where: { email: "import@demo.test" } });
  return { id: user.id, role: "ADMIN" as const };
}

describe("importSchedule – ett utskrivet schema in i den lokala databasen", () => {
  it("skapar personer utan inloggning, med bara förnamn, som testdata i rätt kategori", async () => {
    const r = await importSchedule(db, FILE);
    expect(r.employeesCreated).toEqual(["Anna", "Bo", "Cia", "Dan"]);
    expect(r.shiftsCreated).toBe(8);
    const employees = await db.employee.findMany({ orderBy: { firstName: "asc" } });
    expect(employees.map((e) => [e.firstName, e.lastName, e.category, e.isTestData, e.userId])).toEqual([
      ["Anna", "", "GOLFSHOP", true, null],
      ["Bo", "", "GOLFSHOP", true, null],
      ["Cia", "", "GOLFSHOP", true, null],
      ["Dan", "", "GOLFSHOP", true, null],
    ]);
  });

  it("namn och tid hör ihop i schemat: rätt person på rätt datum, 11.00–15.00 svensk tid", async () => {
    await importSchedule(db, FILE);
    const shifts = await getScheduleMonth(db, await admin(), { year: 2026, month: 11, now: NOW });
    expect(shifts).toHaveLength(8);
    const first = shifts[0];
    expect([first.employeeName, first.localDate, first.startsAt.toISOString(), first.endsAt.toISOString()]).toEqual([
      "Anna", "2026-11-01", "2026-11-01T10:00:00.000Z", "2026-11-01T14:00:00.000Z",
    ]);
    expect(shifts.map((s) => `${s.localDate} ${s.employeeName}`)).toEqual([
      "2026-11-01 Anna", "2026-11-07 Bo", "2026-11-08 Anna", "2026-11-16 Cia",
      "2026-11-21 Anna", "2026-11-22 Bo", "2026-11-23 Cia", "2026-11-28 Cia",
    ]);
    expect(shifts.every((s) => s.publicationStatus === "PUBLISHED" && s.approvalStatus === "APPROVED")).toBe(true);
  });

  it("räknar vad var och en arbetat och tjänat HITTILLS (till och med nu), och vad som återstår", async () => {
    await importSchedule(db, FILE);
    const { rows, totals } = await getPersonnelOverview(db, await admin(), { year: 2026, month: 11, now: NOW });
    const by = Object.fromEntries(rows.map((r) => [r.fullName, r]));
    expect(by.Anna).toMatchObject({ completedMinutes: 720, remainingMinutes: 0, estimatedCompensationOre: 180_000 }); // 12 h × 150 kr
    expect(by.Bo).toMatchObject({ completedMinutes: 480, remainingMinutes: 0, estimatedCompensationOre: 120_000 }); // 8 h
    expect(by.Cia).toMatchObject({ completedMinutes: 480, remainingMinutes: 240, estimatedCompensationOre: 120_000 }); // 28 nov är framtid
    expect(by.Dan).toMatchObject({ completedMinutes: 0, remainingMinutes: 0, estimatedCompensationOre: 0 });
    expect(totals.completedMinutes).toBe(720 + 480 + 480);
    expect(totals.estimatedCompensationOre).toBe(420_000);
  });

  it("ett pass som slutar senare idag räknas inte som genomfört förrän det tagit slut", async () => {
    await importSchedule(db, { ...FILE, shifts: [{ employee: "Anna", date: "2026-11-24", from: "11:00", to: "15:00" }] });
    const before = new Date("2026-11-24T13:00:00Z"); // 14.00: pågår
    const after = new Date("2026-11-24T14:00:00Z"); // 15.00: slut
    const a = (await getPersonnelOverview(db, await admin(), { year: 2026, month: 11, now: before })).rows.find((r) => r.fullName === "Anna")!;
    const b = (await getPersonnelOverview(db, await admin(), { year: 2026, month: 11, now: after })).rows.find((r) => r.fullName === "Anna")!;
    expect([a.completedMinutes, a.remainingMinutes]).toEqual([0, 240]);
    expect([b.completedMinutes, b.remainingMinutes]).toEqual([240, 0]);
  });

  it("är idempotent: körs den igen skapas inget dubbelt", async () => {
    await importSchedule(db, FILE);
    const again = await importSchedule(db, FILE);
    expect(again).toMatchObject({ employeesCreated: [], shiftsCreated: 0, shiftsSkipped: 8, ratesSet: [] });
    expect(await db.employee.count()).toBe(4);
    expect(await db.shift.count()).toBe(8);
    expect(await db.payRate.count()).toBe(4);
  });

  it("kan rätta en platshållarlön (en enda lönepost) och loggar det", async () => {
    await importSchedule(db, FILE);
    const corrected = await importSchedule(db, { ...FILE, employees: FILE.employees.map((e) => (e.firstName === "Anna" ? { ...e, hourlyRateKr: 165 } : e)) });
    expect(corrected.ratesCorrected).toEqual(["Anna"]);
    const anna = await db.employee.findFirstOrThrow({ where: { firstName: "Anna" }, include: { payRates: true } });
    expect(anna.payRates.map((p) => p.hourlyRateOre)).toEqual([16_500]);
    expect(await db.auditLog.count({ where: { action: "PAYRATE_CORRECTED_BY_IMPORT" } })).toBe(1);
    const { rows } = await getPersonnelOverview(db, await admin(), { year: 2026, month: 11, now: NOW });
    expect(rows.find((r) => r.fullName === "Anna")!.estimatedCompensationOre).toBe(198_000); // 12 h × 165 kr
  });

  it("avvisar okänd person och skriver då ingenting", async () => {
    await expect(importSchedule(db, { ...FILE, shifts: [{ employee: "Okänd", date: "2026-11-01", from: "11:00", to: "15:00" }] })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.employee.count()).toBe(0);
    expect(await db.shift.count()).toBe(0);
  });

  it("avvisar ogiltiga tider och tvetydiga förnamn", async () => {
    await expect(importSchedule(db, { ...FILE, shifts: [{ employee: "Anna", date: "2026-11-01", from: "15:00", to: "11:00" }] })).rejects.toBeInstanceOf(ValidationError);
    const twins: ScheduleImportInput = {
      ...FILE,
      employees: [{ firstName: "Eva", lastName: "Ek" }, { firstName: "Eva", lastName: "Lund" }],
      shifts: [{ employee: "Eva", date: "2026-11-01", from: "11:00", to: "15:00" }],
    };
    await expect(importSchedule(db, twins)).rejects.toBeInstanceOf(ValidationError);
    // Fullt namn fungerar
    await expect(importSchedule(db, { ...twins, shifts: [{ employee: "Eva Ek", date: "2026-11-01", from: "11:00", to: "15:00" }] })).resolves.toMatchObject({ shiftsCreated: 1 });
  });

  it("ett överlapp för samma person rullar tillbaka alla pass (databasen skyddar)", async () => {
    await expect(
      importSchedule(db, {
        ...FILE,
        shifts: [
          { employee: "Anna", date: "2026-11-01", from: "11:00", to: "15:00" },
          { employee: "Anna", date: "2026-11-01", from: "13:00", to: "17:00" },
        ],
      }),
    ).rejects.toThrow();
    expect(await db.shift.count()).toBe(0);
  });
});
