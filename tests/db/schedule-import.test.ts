import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import { getAdminDashboard } from "@/server/queries/dashboard";
import { getPersonnelOverview } from "@/server/queries/personnel";
import { getEmployeeProfile } from "@/server/queries/profile";
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

describe("importSchedule – pass med notering och utan timlön (heltidspersonal på ett utskrivet schema)", () => {
  const WITH_NOTES: ScheduleImportInput = {
    category: "GOLFSHOP",
    employees: [{ firstName: "Eli" }, { firstName: "Fia" }], // ingen timlön angiven
    shifts: [
      { employee: "Eli", date: "2026-11-05", from: "09:00", to: "17:00", notes: "öppnar" },
      { employee: "Eli", date: "2026-11-19", from: "12:00", to: "17:00", notes: "Fr. 12" },
      { employee: "Fia", date: "2026-11-05", from: "09:00", to: "17:00" },
    ],
  };

  it("sparar noteringen på passet och visar den i schemat (admin) och hos den anställde", async () => {
    await importSchedule(db, WITH_NOTES);
    const shifts = await getScheduleMonth(db, await admin(), { year: 2026, month: 11, now: NOW });
    expect(shifts.map((s) => [s.employeeName, s.localDate, s.note])).toEqual([
      ["Eli", "2026-11-05", "öppnar"],
      ["Fia", "2026-11-05", null],
      ["Eli", "2026-11-19", "Fr. 12"],
    ]);

    // Den anställde själv ser också noteringen (via en kopplad användare)
    const user = await db.user.create({ data: { email: "eli@demo.test", passwordHash: "x", role: "GOLFSHOP", isTestData: true } });
    const eli = await db.employee.findFirstOrThrow({ where: { firstName: "Eli" } });
    await db.employee.update({ where: { id: eli.id }, data: { userId: user.id } });
    const { getMyMonth } = await import("@/server/queries/self");
    const mine = await getMyMonth(db, { id: user.id, role: "GOLFSHOP" }, { userId: user.id, employeeId: eli.id, year: 2026, month: 11, now: NOW });
    expect(mine.shifts.map((s) => s.note)).toEqual(["öppnar", "Fr. 12"]);
  });

  it("utan angiven timlön finns ingen lönepost: lön 'Saknas' (null) och ingen påhittad ersättning, men timmarna räknas", async () => {
    const r = await importSchedule(db, WITH_NOTES);
    expect(r.ratesSet).toEqual([]);
    expect(await db.payRate.count()).toBe(0);
    const { rows, totals } = await getPersonnelOverview(db, await admin(), { year: 2026, month: 11, now: NOW });
    const eli = rows.find((p) => p.fullName === "Eli")!;
    expect(eli).toMatchObject({ hourlyRateOre: null, completedMinutes: 480 + 300, estimatedCompensationOre: 0, shiftsMissingRate: 2 });
    // Totalen talar om att passen utan lön inte ingår (Eli 2 pass + Fia 1 pass)
    expect(totals.shiftsMissingRate).toBe(3);
    expect(totals.estimatedCompensationOre).toBe(0);
  });

  it("'Fr. 12' börjar 12.00 svensk tid (11.00 UTC på vintern) och ger 5 timmar", async () => {
    await importSchedule(db, WITH_NOTES);
    const s = (await getScheduleMonth(db, await admin(), { year: 2026, month: 11, now: NOW })).find((x) => x.note === "Fr. 12")!;
    expect([s.startsAt.toISOString(), s.endsAt.toISOString(), s.minutes]).toEqual(["2026-11-19T11:00:00.000Z", "2026-11-19T16:00:00.000Z", 300]);
  });
});

describe("importSchedule – administratörer som styr över de anställda", () => {
  const MIXED: ScheduleImportInput = {
    category: "GOLFSHOP",
    employees: [
      { firstName: "Ola", admin: true }, // admin: ingen timlön som standard
      { firstName: "Pia", hourlyRateKr: 150, rateFrom: "2026-01-01" }, // timanställd
    ],
    shifts: [
      { employee: "Ola", date: "2026-11-05", from: "09:00", to: "17:00", notes: "öppnar" },
      { employee: "Ola", date: "2026-11-26", from: "09:00", to: "17:00" }, // framtid
      { employee: "Pia", date: "2026-11-07", from: "11:00", to: "15:00" },
    ],
  };

  it("skapar ett admin-konto utan användbart lösenord, kopplat till anställningen, och sätter 'ej timlön'", async () => {
    const r = await importSchedule(db, MIXED);
    expect(r.adminsLinked).toEqual(["Ola"]);
    const ola = await db.employee.findFirstOrThrow({ where: { firstName: "Ola" }, include: { user: true } });
    expect([ola.hourlyPaid, ola.user?.role, ola.user?.isTestData, ola.user?.email, ola.user?.name]).toEqual([false, "ADMIN", true, "ola.test@demo.test", "Ola"]);
    expect(ola.user?.passwordHash.startsWith("$argon2id$")).toBe(true);
    const pia = await db.employee.findFirstOrThrow({ where: { firstName: "Pia" } });
    expect([pia.hourlyPaid, pia.userId]).toEqual([true, null]);
  });

  it("administratören kan inte logga in (okänt slumpat lösenord) men kontot finns som admin", async () => {
    await importSchedule(db, MIXED);
    const { authenticate } = await import("@/server/auth/login");
    for (const password of ["password", "ola", "demo-losenord-2026", "test-password-12345"]) {
      expect(await authenticate(db, { email: "ola.test@demo.test", password, audience: "ADMIN" })).toEqual({ ok: false, reason: "INVALID" });
    }
  });

  it("personallistan skiljer administratörer från anställda och räknar bara timanställda i timmar, kronor och saknad lön", async () => {
    await importSchedule(db, MIXED);
    const { rows, totals } = await getPersonnelOverview(db, await admin(), { year: 2026, month: 11, now: NOW });
    const ola = rows.find((r) => r.fullName === "Ola")!;
    const pia = rows.find((r) => r.fullName === "Pia")!;
    expect([ola.isAdmin, ola.hourlyPaid, ola.hourlyRateOre, ola.completedMinutes, ola.remainingMinutes]).toEqual([true, false, null, 480, 480]); // tiden på plats räknas för personen...
    expect([pia.isAdmin, pia.hourlyPaid, pia.completedMinutes, pia.estimatedCompensationOre]).toEqual([false, true, 240, 60_000]);
    // ...men inte i timlönetotalerna:
    expect(totals).toMatchObject({ employees: 1, admins: 1, completedMinutes: 240, remainingMinutes: 0, estimatedCompensationOre: 60_000, shiftsMissingRate: 0 });
    expect(totals.byCategory.GOLFSHOP).toMatchObject({ employees: 1, admins: 1, completedMinutes: 240 });
  });

  it("adminöversikten räknar anställda utan administratörer, och schemat markerar vem som är admin", async () => {
    await importSchedule(db, MIXED);
    const d = await getAdminDashboard(db, await admin(), NOW);
    expect(d.employees).toEqual({ total: 1, golfshop: 1, bollplockare: 0, admins: 1 });
    const shifts = await getScheduleMonth(db, await admin(), { year: 2026, month: 11, now: NOW });
    expect(shifts.map((s) => [s.employeeName, s.employeeIsAdmin])).toEqual([["Ola", true], ["Pia", false], ["Ola", true]]);
  });

  it("profilen visar att personen är administratör och inte timanställd", async () => {
    await importSchedule(db, MIXED);
    const ola = await db.employee.findFirstOrThrow({ where: { firstName: "Ola" } });
    const p = await getEmployeeProfile(db, await admin(), ola.id, { year: 2026, month: 11, now: NOW });
    expect([p.isAdmin, p.hourlyPaid, p.currentHourlyRateOre]).toEqual([true, false, null]);
  });

  it("fast lön och mottagare av dagsavslut: sätts på admin, visas som 'Fast lön', och går inte att blanda med timlön", async () => {
    const withFlags: ScheduleImportInput = {
      ...MIXED,
      employees: [{ firstName: "Ola", admin: true, fixedSalary: true, receivesDailyClosings: true }, MIXED.employees[1]],
    };
    await importSchedule(db, withFlags);
    const ola = await db.employee.findFirstOrThrow({ where: { firstName: "Ola" }, include: { user: true } });
    expect([ola.fixedSalary, ola.hourlyPaid, ola.user?.receivesDailyClosings]).toEqual([true, false, true]);
    const p = await getEmployeeProfile(db, await admin(), ola.id, { year: 2026, month: 11, now: NOW });
    expect([p.fixedSalary, p.hourlyPaid]).toEqual([true, false]);
    const { rows } = await getPersonnelOverview(db, await admin(), { year: 2026, month: 11, now: NOW });
    expect(rows.find((r) => r.firstName === "Ola")?.fixedSalary).toBe(true);
    expect(rows.find((r) => r.firstName === "Pia")?.fixedSalary).toBe(false);

    await expect(importSchedule(db, { ...MIXED, employees: [{ firstName: "Ola", hourlyPaid: true, fixedSalary: true }, MIXED.employees[1]] })).rejects.toThrow(/fast lön/i);
    await expect(importSchedule(db, { ...MIXED, employees: [{ firstName: "Ola", receivesDailyClosings: true }, MIXED.employees[1]] })).rejects.toThrow(/administratörer/);
    // databasen skyddar också mot fast lön för en timanställd
    await expect(db.employee.update({ where: { id: ola.id }, data: { hourlyPaid: true } })).rejects.toThrow();
  });

  it("är idempotent, och en redan importerad anställd kan senare göras till admin (kopplar konto, ändrar inte pass)", async () => {
    const asEmployee: ScheduleImportInput = { ...MIXED, employees: [{ firstName: "Ola", hourlyPaid: true }, MIXED.employees[1]] };
    await importSchedule(db, asEmployee);
    expect(await db.user.count({ where: { role: "ADMIN", name: "Ola" } })).toBe(0);

    const second = await importSchedule(db, MIXED); // nu som admin
    expect(second.adminsLinked).toEqual(["Ola"]);
    expect(second.shiftsCreated).toBe(0);
    const third = await importSchedule(db, MIXED);
    expect(third.adminsLinked).toEqual([]); // redan kopplad
    expect(await db.user.count({ where: { name: "Ola" } })).toBe(1);
    expect((await db.employee.findFirstOrThrow({ where: { firstName: "Ola" } })).hourlyPaid).toBe(false);
  });

  it("ändrar aldrig rollen på ett redan kopplat konto som inte är admin (varnar i stället)", async () => {
    await importSchedule(db, { ...MIXED, employees: [{ firstName: "Ola" }, MIXED.employees[1]] });
    const ola = await db.employee.findFirstOrThrow({ where: { firstName: "Ola" } });
    const staff = await db.user.create({ data: { email: "ola.staff@demo.test", passwordHash: "x", role: "GOLFSHOP", isTestData: true } });
    await db.employee.update({ where: { id: ola.id }, data: { userId: staff.id } });

    const r = await importSchedule(db, MIXED);
    expect(r.adminsLinked).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).role).toBe("GOLFSHOP");
  });
});

describe("administratör som också är timanställd", () => {
  it("visas bland de anställda med sin timlön och sina timmar, utan admin-markering (så en admin-konto kopplat till en timanställd inte felklassas)", async () => {
    await importSchedule(db, MIXED_FOR_HOURLY);
    const pia = await db.employee.findFirstOrThrow({ where: { firstName: "Pia" } });
    const adminUser = await db.user.create({ data: { email: "pia.test@demo.test", name: "Pia", passwordHash: "x", role: "ADMIN", isTestData: true } });
    await db.employee.update({ where: { id: pia.id }, data: { userId: adminUser.id } });

    const { rows, totals } = await getPersonnelOverview(db, await admin(), { year: 2026, month: 11, now: NOW });
    const row = rows.find((r) => r.fullName === "Pia")!;
    expect([row.isAdmin, row.hourlyPaid, row.completedMinutes, row.estimatedCompensationOre]).toEqual([false, true, 240, 60_000]);
    expect(totals).toMatchObject({ employees: 1, admins: 0, estimatedCompensationOre: 60_000 });
    const shifts = await getScheduleMonth(db, await admin(), { year: 2026, month: 11, now: NOW });
    expect(shifts.every((s) => s.employeeIsAdmin === false)).toBe(true);
  });
});

const MIXED_FOR_HOURLY: ScheduleImportInput = {
  category: "GOLFSHOP",
  employees: [{ firstName: "Pia", hourlyRateKr: 150, rateFrom: "2026-01-01" }],
  shifts: [{ employee: "Pia", date: "2026-11-07", from: "11:00", to: "15:00" }],
};
