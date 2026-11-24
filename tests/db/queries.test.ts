import { beforeEach, describe, expect, it } from "vitest";
import { dateStringToDbDate } from "@/domain/time";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getAdminDashboard } from "@/server/queries/dashboard";
import { getPersonnelOverview } from "@/server/queries/personnel";
import { getEmployeeProfile } from "@/server/queries/profile";
import { getScheduleMonth } from "@/server/queries/schedule";
import { getMyMonth } from "@/server/queries/self";
import { changeHourlyRate } from "@/server/services/pay-rates";
import { makeAdmin, makeEmployee, makeShift, resetDb, testDb } from "./helpers";

const db = testDb();
// Tisdag 24 november 2026, 12.00 svensk tid.
const NOW = new Date("2026-11-24T11:00:00Z");
const ym = { year: 2026, month: 11 };

async function world() {
  const adminUser = await makeAdmin(db, "Anna Admin");
  const admin = { id: adminUser.id, role: "ADMIN" as const };
  const erik = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
  const lisa = await makeEmployee(db, { firstName: "Lisa", lastName: "Svensson" });
  const oscar = await makeEmployee(db, { firstName: "Oscar", lastName: "Nilsson", category: "BOLLPLOCKARE" });
  for (const [e, kr] of [[erik, 140], [lisa, 150], [oscar, 140]] as const) {
    await changeHourlyRate(db, admin, { employeeId: e.employee.id, hourlyRateOre: kr * 100, effectiveFrom: "2026-01-01" });
  }
  const shift = (who: typeof erik, date: string, from: string, to: string, extra = {}) =>
    makeShift(db, { employeeId: who.employee.id, createdById: adminUser.id, date, from, to, category: who.employee.category, publicationStatus: "PUBLISHED", approvalStatus: "APPROVED", ...extra });
  return { adminUser, admin, erik, lisa, oscar, shift };
}

beforeEach(async () => {
  await resetDb(db);
});

describe("Personalöversikt (Admin): lön, arbetade och kommande timmar", () => {
  it("visar varje anställd med rätt namn, kategori, timlön, genomfört, kommande och preliminär ersättning", async () => {
    const { admin, erik, lisa, shift } = await world();
    await shift(erik, "2026-11-03", "11:00", "15:00"); // 4 h genomfört
    await shift(erik, "2026-11-08", "10:00", "16:00"); // 6 h genomfört
    await shift(erik, "2026-11-24", "10:00", "14:00"); // 4 h pågår (kommande/återstående)
    await shift(erik, "2026-11-28", "09:00", "13:00"); // 4 h kommande
    for (const d of ["16", "17", "18", "19", "20"]) await shift(lisa, `2026-11-${d}`, "09:00", "13:00"); // 20 h

    const { rows, totals } = await getPersonnelOverview(db, admin, { ...ym, now: NOW });
    const e = rows.find((r) => r.fullName === "Erik Andersson")!;
    expect(e).toMatchObject({ category: "GOLFSHOP", hourlyRateOre: 14_000, completedMinutes: 600, remainingMinutes: 480, totalMinutes: 1080 });
    expect(e.estimatedCompensationOre).toBe(140_000); // 10 h × 140 kr, bara genomförda
    expect(e.nextShift?.startsAt.toISOString()).toBe("2026-11-24T09:00:00.000Z"); // pågående pass är "nästa"

    const l = rows.find((r) => r.fullName === "Lisa Svensson")!;
    expect(l.completedMinutes).toBe(1200);
    expect(l.estimatedCompensationOre).toBe(300_000); // Test 7: 20 h × 150 kr = 3 000 kr

    expect(totals.employees).toBe(3);
    expect(totals.completedMinutes).toBe(600 + 1200);
    expect(totals.byCategory.GOLFSHOP.employees).toBe(2);
    expect(totals.byCategory.BOLLPLOCKARE.employees).toBe(1);
  });

  it("Test 12: framtida pass ger varken genomförda timmar eller ersättning", async () => {
    const { admin, erik, shift } = await world();
    await shift(erik, "2026-11-28", "09:00", "13:00");
    const { rows } = await getPersonnelOverview(db, admin, { ...ym, now: NOW });
    expect(rows[0]).toMatchObject({ completedMinutes: 0, remainingMinutes: 240, estimatedCompensationOre: 0 });
  });

  it("inställda pass och frånvaro räknas inte", async () => {
    const { admin, erik, shift } = await world();
    await shift(erik, "2026-11-03", "11:00", "15:00", { workStatus: "CANCELLED" });
    await shift(erik, "2026-11-04", "11:00", "15:00", { workStatus: "ABSENT" });
    const { rows } = await getPersonnelOverview(db, admin, { ...ym, now: NOW });
    expect(rows[0]).toMatchObject({ completedMinutes: 0, remainingMinutes: 0, totalMinutes: 0 });
  });

  it("ett pass hör till månaden där det BÖRJAR (Stockholm-tid)", async () => {
    const { admin, erik, shift } = await world();
    await shift(erik, "2026-11-30", "23:00", "03:00", { endDate: "2026-12-01" }); // börjar i november
    await shift(erik, "2026-12-01", "04:00", "08:00"); // börjar i december (efter det första passet slutat)
    const nov = await getPersonnelOverview(db, admin, { ...ym, now: NOW });
    const dec = await getPersonnelOverview(db, admin, { year: 2026, month: 12, now: NOW });
    expect(nov.rows[0].totalMinutes).toBe(240);
    expect(dec.rows[0].totalMinutes).toBe(240);
  });

  it("historisk timlön: pass före och efter en lönehöjning räknas med sin egen lön (Test 11)", async () => {
    const { admin, erik, shift } = await world();
    await changeHourlyRate(db, admin, { employeeId: erik.employee.id, hourlyRateOre: 15_000, effectiveFrom: "2026-11-15" });
    await shift(erik, "2026-11-03", "11:00", "15:00"); // 4 h × 140
    await shift(erik, "2026-11-20", "10:00", "14:00"); // 4 h × 150
    const { rows } = await getPersonnelOverview(db, admin, { ...ym, now: NOW });
    expect(rows[0].estimatedCompensationOre).toBe(56_000 + 60_000);
    expect(rows[0].hourlyRateOre).toBe(15_000); // gällande lön idag
  });

  it("filtrerar på kategori och söker på namn (skiftlägesokänsligt, delar av namn)", async () => {
    const { admin } = await world();
    const names = async (input: Record<string, unknown>) => (await getPersonnelOverview(db, admin, { ...ym, now: NOW, ...input })).rows.map((r) => r.fullName);
    expect(await names({ category: "GOLFSHOP" })).toEqual(["Erik Andersson", "Lisa Svensson"]);
    expect(await names({ category: "BOLLPLOCKARE" })).toEqual(["Oscar Nilsson"]);
    expect(await names({ search: "LIS" })).toEqual(["Lisa Svensson"]);
    expect(await names({ search: "andersson erik" })).toEqual(["Erik Andersson"]);
    expect(await names({ search: "finns inte" })).toEqual([]);
  });

  it("saknad timlön visas som null (inte 0 kr)", async () => {
    const { admin } = await world();
    await makeEmployee(db, { firstName: "Ny", lastName: "Person" });
    const { rows } = await getPersonnelOverview(db, admin, { ...ym, now: NOW });
    expect(rows.find((r) => r.fullName === "Ny Person")?.hourlyRateOre).toBeNull();
  });

  it("SÄKERHET: bara Admin. Personal får aldrig läsa andras löner och timmar", async () => {
    const { erik, oscar } = await world();
    for (const who of [erik, oscar]) {
      const actor = { id: who.user!.id, role: who.employee.category };
      await expect(getPersonnelOverview(db, actor, { ...ym, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("Schema (Admin): hela schemat med namn vid varje pass", () => {
  it("Test 2 + 8: Erik och Lisa samma dag visas båda, med rätt namn kopplat till rätt tid", async () => {
    const { admin, erik, lisa, shift } = await world();
    await shift(erik, "2026-11-28", "09:00", "13:00");
    await shift(lisa, "2026-11-28", "13:00", "17:00");
    const shifts = await getScheduleMonth(db, admin, { ...ym, now: NOW });
    expect(shifts.map((s) => [s.employeeName, s.startsAt.toISOString()])).toEqual([
      ["Erik Andersson", "2026-11-28T08:00:00.000Z"],
      ["Lisa Svensson", "2026-11-28T12:00:00.000Z"],
    ]);
  });

  it("båda grupperna samlat eller var för sig", async () => {
    const { admin, erik, oscar, shift } = await world();
    await shift(erik, "2026-11-28", "09:00", "13:00");
    await shift(oscar, "2026-11-28", "10:00", "15:00");
    const all = await getScheduleMonth(db, admin, { ...ym, now: NOW });
    const golf = await getScheduleMonth(db, admin, { ...ym, category: "GOLFSHOP", now: NOW });
    const ball = await getScheduleMonth(db, admin, { ...ym, category: "BOLLPLOCKARE", now: NOW });
    expect(all).toHaveLength(2);
    expect(golf.map((s) => s.employeeName)).toEqual(["Erik Andersson"]);
    expect(ball.map((s) => s.employeeName)).toEqual(["Oscar Nilsson"]);
  });

  it("efter ett passbyte syns den som arbetar, och den ursprungliga finns kvar", async () => {
    const { admin, erik, lisa, shift } = await world();
    const s = await shift(erik, "2026-11-28", "09:00", "13:00");
    await db.shift.update({ where: { id: s.id }, data: { assignedEmployeeId: lisa.employee.id, approvalStatus: "APPROVED_AFTER_SWAP" } });
    const [row] = await getScheduleMonth(db, admin, { ...ym, now: NOW });
    expect(row.employeeName).toBe("Lisa Svensson");
    expect(row.originalEmployeeName).toBe("Erik Andersson");
    expect(row.approvalStatus).toBe("APPROVED_AFTER_SWAP");
  });

  it("utkast syns för Admin med publiceringsstatus", async () => {
    const { admin, erik, shift } = await world();
    await shift(erik, "2026-11-28", "09:00", "13:00", { publicationStatus: "DRAFT" });
    expect((await getScheduleMonth(db, admin, { ...ym, now: NOW }))[0].publicationStatus).toBe("DRAFT");
  });

  it("SÄKERHET: personal får inte läsa hela schemat", async () => {
    const { erik } = await world();
    await expect(getScheduleMonth(db, { id: erik.user!.id, role: "GOLFSHOP" }, { ...ym, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Adminöversikt: bara riktiga siffror", () => {
  it("räknar anställda, dagens pass, pågående, väntande godkännanden och utkast", async () => {
    const { admin, erik, lisa, oscar, shift } = await world();
    await shift(erik, "2026-11-24", "10:00", "14:00"); // pågår nu
    await shift(lisa, "2026-11-24", "13:00", "17:00"); // senare idag
    await shift(oscar, "2026-11-24", "07:00", "11:00"); // klart idag
    await shift(erik, "2026-11-28", "09:00", "13:00", { approvalStatus: "PENDING" });
    await shift(lisa, "2026-11-29", "09:00", "13:00", { publicationStatus: "DRAFT" });

    const d = await getAdminDashboard(db, admin, NOW);
    expect(d.employees).toEqual({ total: 3, golfshop: 2, bollplockare: 1 });
    expect(d.today.map((s) => [s.employeeName, s.phase])).toEqual([
      ["Oscar Nilsson", "COMPLETED"],
      ["Erik Andersson", "ONGOING"],
      ["Lisa Svensson", "UPCOMING"],
    ]);
    expect(d.actions).toEqual({ pendingApprovals: 1, draftShifts: 1, openSwapRequests: 0 });
    expect(d.approvedMinutes).toBe(0);
    expect(d.monthTotals.completedMinutes).toBe(240);
    // Kommande = startar efter nu: Lisa senare idag, Erik 28:e, Lisa 29:e. Pågående och avslutade räknas inte.
    expect(d.upcoming).toHaveLength(3);
  });

  it("SÄKERHET: personal får inte läsa adminöversikten", async () => {
    const { erik } = await world();
    await expect(getAdminDashboard(db, { id: erik.user!.id, role: "GOLFSHOP" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Personalprofil (Admin)", () => {
  it("ger lönehistorik, pass med timlön och ersättning samt andra anställningar för samma person", async () => {
    const { admin, erik, shift } = await world();
    await changeHourlyRate(db, admin, { employeeId: erik.employee.id, hourlyRateOre: 15_000, effectiveFrom: "2026-11-15" });
    await shift(erik, "2026-11-03", "11:00", "15:00");
    await shift(erik, "2026-11-20", "10:00", "14:00");
    await shift(erik, "2026-11-28", "09:00", "13:00");
    await db.employee.create({ data: { userId: erik.user!.id, firstName: "Erik", lastName: "Andersson", category: "BOLLPLOCKARE", isTestData: true } });

    const p = await getEmployeeProfile(db, admin, erik.employee.id, { ...ym, now: NOW });
    expect(p.rateHistory.map((r) => [r.hourlyRateOre, r.validFrom, r.validTo])).toEqual([[14_000, "2026-01-01", "2026-11-15"], [15_000, "2026-11-15", null]]);
    expect(p.shifts.map((s) => [s.localDate, s.hourlyRateOre, s.estimatedCompensationOre])).toEqual([
      ["2026-11-03", 14_000, 56_000],
      ["2026-11-20", 15_000, 60_000],
      ["2026-11-28", 15_000, null], // framtida pass: ingen ersättning
    ]);
    expect(p.estimatedCompensationOre).toBe(116_000);
    expect(p.otherEmploymentCategories).toEqual(["BOLLPLOCKARE"]);
  });

  it("okänt id ger NotFound, personal nekas", async () => {
    const { admin, erik } = await world();
    await expect(getEmployeeProfile(db, admin, "finns-inte", { ...ym, now: NOW })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getEmployeeProfile(db, { id: erik.user!.id, role: "GOLFSHOP" }, erik.employee.id, { ...ym, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Anställd: bara mina egna pass och timmar", () => {
  it("visar mina publicerade pass, nästa pass, timmar och väntande godkännanden", async () => {
    const { erik, shift } = await world();
    await shift(erik, "2026-11-03", "11:00", "15:00");
    await shift(erik, "2026-11-28", "09:00", "13:00", { approvalStatus: "PENDING" });
    await shift(erik, "2026-11-29", "09:00", "13:00", { publicationStatus: "DRAFT" }); // utkast: dolt för personalen
    const actor = { id: erik.user!.id, role: "GOLFSHOP" as const };
    const my = await getMyMonth(db, actor, { userId: erik.user!.id, employeeId: erik.employee.id, ...ym, now: NOW });
    expect(my.shifts.map((s) => s.localDate)).toEqual(["2026-11-03", "2026-11-28"]);
    expect(my.summary).toMatchObject({ completedMinutes: 240, remainingMinutes: 240 });
    expect(my.next?.localDate).toBe("2026-11-28");
    expect(my.pendingApprovals).toBe(1);
  });

  it("SÄKERHET: man kan inte läsa en annan persons pass genom att byta id", async () => {
    const { erik, lisa, shift } = await world();
    await shift(lisa, "2026-11-28", "13:00", "17:00");
    const actor = { id: erik.user!.id, role: "GOLFSHOP" as const };
    await expect(
      getMyMonth(db, actor, { userId: erik.user!.id, employeeId: lisa.employee.id, ...ym, now: NOW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ersättning visas bara om Admin slagit på det, och bara min egen", async () => {
    const { erik, shift } = await world();
    await shift(erik, "2026-11-03", "11:00", "15:00");
    const actor = { id: erik.user!.id, role: "GOLFSHOP" as const };
    const input = { userId: erik.user!.id, employeeId: erik.employee.id, ...ym, now: NOW };
    expect((await getMyMonth(db, actor, input)).estimatedCompensationOre).toBeNull();
    await db.employee.update({ where: { id: erik.employee.id }, data: { showEarningsToEmployee: true } });
    expect((await getMyMonth(db, actor, input)).estimatedCompensationOre).toBe(56_000);
  });

  it("en admin som också jobbar ser sin anställning i anställdvyn, men inget om andra", async () => {
    const { adminUser, lisa } = await world();
    const mine = await db.employee.create({ data: { userId: adminUser.id, firstName: "Anna", lastName: "Admin", category: "GOLFSHOP", isTestData: true } });
    const actor = { id: adminUser.id, role: "GOLFSHOP" as const }; // anställdsession
    const my = await getMyMonth(db, actor, { userId: adminUser.id, employeeId: mine.id, ...ym, now: NOW });
    expect(my.firstName).toBe("Anna");
    await expect(getMyMonth(db, actor, { userId: adminUser.id, employeeId: lisa.employee.id, ...ym, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPersonnelOverview(db, actor, { ...ym, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("inaktiv anställning kan inte läsas", async () => {
    const { erik } = await world();
    await db.employee.update({ where: { id: erik.employee.id }, data: { status: "INACTIVE" } });
    const actor = { id: erik.user!.id, role: "GOLFSHOP" as const };
    await expect(getMyMonth(db, actor, { userId: erik.user!.id, employeeId: erik.employee.id, ...ym, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

void dateStringToDbDate;
