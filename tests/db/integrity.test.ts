import { beforeEach, describe, expect, it } from "vitest";
import { dateStringToDbDate, localToInstant } from "@/domain/time";
import { makeAdmin, makeEmployee, makeShift, resetDb, testDb } from "./helpers";

/**
 * Bevisar att databasens egna garantier gäller – oberoende av tjänstekod.
 * Varje regel motsvarar ett krav i specen (se kommentar per test).
 */
const db = testDb();

async function setup() {
  const admin = await makeAdmin(db);
  const erik = (await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" })).employee;
  const lisa = (await makeEmployee(db, { firstName: "Lisa", lastName: "Svensson" })).employee;
  return { admin, erik, lisa };
}

beforeEach(async () => {
  await resetDb(db);
});

describe("pass: dubbelbokning (spec 6.3)", () => {
  it("Test 1+2: Erik och Lisa kan båda arbeta 28 nov, samma tid, med rätt namn kopplade", async () => {
    const { admin, erik, lisa } = await setup();
    await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "11:00", to: "15:00" });
    await makeShift(db, { employeeId: lisa.id, createdById: admin.id, date: "2026-11-28", from: "11:00", to: "15:00" });

    const shifts = await db.shift.findMany({
      where: { localDate: dateStringToDbDate("2026-11-28") },
      include: { assignedEmployee: true },
      orderBy: { assignedEmployee: { firstName: "asc" } },
    });
    expect(shifts.map((s) => `${s.assignedEmployee.firstName} ${s.assignedEmployee.lastName}`)).toEqual([
      "Erik Andersson",
      "Lisa Svensson",
    ]);
    expect(shifts[0].startsAt.toISOString()).toBe("2026-11-28T10:00:00.000Z"); // 11.00 Stockholm
    expect(shifts[0].endsAt.toISOString()).toBe("2026-11-28T14:00:00.000Z");
  });

  it("nekar överlappande pass för samma person", async () => {
    const { admin, erik } = await setup();
    await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "11:00", to: "15:00" });
    await expect(
      makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "14:00", to: "18:00" }),
    ).rejects.toThrow(/Shift_no_overlap_per_employee|exclusion/i);
  });

  it("tillåter pass som ligger direkt efter varandra och två pass samma dag", async () => {
    const { admin, erik } = await setup();
    await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "09:00", to: "13:00" });
    await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "13:00", to: "17:00" });
    expect(await db.shift.count({ where: { assignedEmployeeId: erik.id } })).toBe(2);
  });

  it("ignorerar inställda pass", async () => {
    const { admin, erik } = await setup();
    await makeShift(db, {
      employeeId: erik.id,
      createdById: admin.id,
      date: "2026-11-28",
      from: "11:00",
      to: "15:00",
      workStatus: "CANCELLED",
    });
    await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "12:00", to: "14:00" });
    expect(await db.shift.count()).toBe(2);
  });

  it("nekar att flytta ett pass in i ett annat (UPDATE)", async () => {
    const { admin, erik } = await setup();
    await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "09:00", to: "11:00" });
    const second = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "12:00", to: "14:00" });
    await expect(
      db.shift.update({ where: { id: second.id }, data: { startsAt: localToInstant("2026-11-28", "10:00") } }),
    ).rejects.toThrow(/Shift_no_overlap_per_employee|exclusion/i);
  });

  it("nekar passbyte till en person som redan har ett överlappande pass", async () => {
    const { admin, erik, lisa } = await setup();
    const eriks = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "11:00", to: "15:00" });
    await makeShift(db, { employeeId: lisa.id, createdById: admin.id, date: "2026-11-28", from: "13:00", to: "17:00" });
    await expect(
      db.shift.update({ where: { id: eriks.id }, data: { assignedEmployeeId: lisa.id } }),
    ).rejects.toThrow(/Shift_no_overlap_per_employee|exclusion/i);
  });

  it("nekar pass där slut ≤ start", async () => {
    const { admin, erik } = await setup();
    await expect(
      makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "15:00", to: "11:00" }),
    ).rejects.toThrow(/Shift_time_order_chk|check/i);
  });
});

describe("Test 5 (databasnivå): passbyte bevarar ursprunglig tilldelning", () => {
  it("assignedEmployeeId kan ändras, originalEmployeeId aldrig", async () => {
    const { admin, erik, lisa } = await setup();
    const shift = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "11:00", to: "15:00" });

    const swapped = await db.shift.update({
      where: { id: shift.id },
      data: { assignedEmployeeId: lisa.id, approvalStatus: "APPROVED_AFTER_SWAP", version: { increment: 1 } },
    });
    expect(swapped.assignedEmployeeId).toBe(lisa.id);
    expect(swapped.originalEmployeeId).toBe(erik.id);

    await expect(
      db.shift.update({ where: { id: shift.id }, data: { originalEmployeeId: lisa.id } }),
    ).rejects.toThrow(/oföränderlig/);
  });
});

describe("passbytesförfrågningar", () => {
  it("högst en öppen förfrågan per pass, ny tillåts efter avslag", async () => {
    const { admin, erik, lisa } = await setup();
    const shift = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "11:00", to: "15:00" });
    const base = { shiftId: shift.id, requesterId: erik.id, proposedEmployeeId: lisa.id, reason: "Sjuk", shiftVersionAtRequest: 1 };

    const first = await db.shiftSwapRequest.create({ data: base });
    await expect(db.shiftSwapRequest.create({ data: base })).rejects.toThrow(/one_open_per_shift|unique/i);

    await db.shiftSwapRequest.update({ where: { id: first.id }, data: { status: "DECLINED_BY_COLLEAGUE" } });
    await expect(db.shiftSwapRequest.create({ data: base })).resolves.toBeTruthy();
  });

  it("man kan inte föreslå sig själv", async () => {
    const { admin, erik } = await setup();
    const shift = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "11:00", to: "15:00" });
    await expect(
      db.shiftSwapRequest.create({
        data: { shiftId: shift.id, requesterId: erik.id, proposedEmployeeId: erik.id, reason: "x", shiftVersionAtRequest: 1 },
      }),
    ).rejects.toThrow(/not_self_chk|check/i);
  });
});

describe("timlön: perioder får inte överlappa", () => {
  it("nekar överlappande perioder, tillåter angränsande", async () => {
    const { admin, erik } = await setup();
    const rate = (from: string, to: string | null, ore: number) =>
      db.payRate.create({
        data: {
          employeeId: erik.id,
          hourlyRateOre: ore,
          validFrom: dateStringToDbDate(from),
          validTo: to ? dateStringToDbDate(to) : null,
          createdById: admin.id,
        },
      });
    await rate("2026-01-01", "2026-06-01", 14000);
    await rate("2026-06-01", null, 15000); // angränsande = OK
    await expect(rate("2026-09-01", null, 16000)).rejects.toThrow(/PayRate_no_overlap|exclusion/i);
  });

  it("nekar negativ timlön och omvänd period", async () => {
    const { admin, erik } = await setup();
    const base = { employeeId: erik.id, createdById: admin.id, validFrom: dateStringToDbDate("2026-01-01") };
    await expect(db.payRate.create({ data: { ...base, hourlyRateOre: -1 } })).rejects.toThrow(/PayRate_amount_chk|check/i);
    await expect(
      db.payRate.create({ data: { ...base, hourlyRateOre: 100, validTo: dateStringToDbDate("2025-12-01") } }),
    ).rejects.toThrow(/PayRate_period_chk|check/i);
  });
});

describe("arbetstid: framtid och dubbletter (spec 10, Test 6 + 12)", () => {
  async function entryFor(shift: Awaited<ReturnType<typeof makeShift>>, employeeId: string, overrides = {}) {
    return db.workTimeEntry.create({
      data: {
        shiftId: shift.id,
        employeeId,
        workDate: shift.localDate,
        category: "GOLFSHOP",
        source: "SCHEDULE",
        scheduledStartsAt: shift.startsAt,
        scheduledEndsAt: shift.endsAt,
        scheduledMinutes: 240,
        registeredMinutes: 240,
        ...overrides,
      },
    });
  }

  it("Test 12: ett framtida pass kan inte få tidsregistrering", async () => {
    const { admin, erik } = await setup();
    const future = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2099-01-10", from: "11:00", to: "15:00" });
    await expect(entryFor(future, erik.id)).rejects.toThrow(/inte avslutats/);
  });

  it("Test 6: ett avslutat pass ger exakt EN preliminär registrering – dubblett nekas", async () => {
    const { admin, erik } = await setup();
    const past = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-03", from: "11:00", to: "15:00" });
    const entry = await entryFor(past, erik.id);
    expect(entry.status).toBe("PRELIMINARY");
    expect(entry.approvedMinutes).toBeNull(); // schemalagd/preliminär tid är INTE godkänd tid
    await expect(entryFor(past, erik.id)).rejects.toThrow(/unique|shiftId/i);
    expect(await db.workTimeEntry.count()).toBe(1);
  });

  it("godkänd tid kräver minuter, tidpunkt och godkännare", async () => {
    const { admin, erik } = await setup();
    const past = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-03", from: "11:00", to: "15:00" });
    await expect(entryFor(past, erik.id, { status: "APPROVED" })).rejects.toThrow(/approved_requires_fields/i);
    const ok = await entryFor(past, erik.id, {
      status: "APPROVED",
      approvedMinutes: 240,
      approvedAt: new Date(),
      approvedById: admin.id,
    });
    expect(ok.approvedMinutes).toBe(240);
  });

  it("framtida arbetstid kan inte godkännas (GPS-källa med framtida slut)", async () => {
    const { admin, erik } = await setup();
    const future = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2099-01-10", from: "11:00", to: "15:00" });
    await expect(
      entryFor(future, erik.id, {
        source: "GPS",
        status: "APPROVED",
        approvedMinutes: 240,
        approvedAt: new Date(),
        approvedById: admin.id,
      }),
    ).rejects.toThrow(/framtida arbetstid/);
  });

  it("GPS: incheckning före passets slut ger en preliminär post, men den kan inte godkännas förrän efteråt", async () => {
    const { admin, erik } = await setup();
    const future = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2099-01-10", from: "11:00", to: "15:00" });
    const entry = await entryFor(future, erik.id, {
      source: "GPS",
      registeredStartsAt: future.startsAt,
      registeredMinutes: 0,
    });
    expect(entry.status).toBe("PRELIMINARY");
    await expect(
      db.workTimeEntry.update({
        where: { id: entry.id },
        data: { status: "APPROVED", approvedMinutes: 240, approvedAt: new Date(), approvedById: admin.id },
      }),
    ).rejects.toThrow(/framtida arbetstid/);
  });

  it("registreringen tillhör den som faktiskt arbetade passet efter ett byte (Test 5 + 8)", async () => {
    const { admin, erik, lisa } = await setup();
    const past = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-03", from: "11:00", to: "15:00" });
    await db.shift.update({ where: { id: past.id }, data: { assignedEmployeeId: lisa.id, approvalStatus: "APPROVED_AFTER_SWAP" } });
    const current = await db.shift.findUniqueOrThrow({ where: { id: past.id } });
    const entry = await entryFor(current, current.assignedEmployeeId);
    expect(entry.employeeId).toBe(lisa.id);
    expect(current.originalEmployeeId).toBe(erik.id);
  });
});

describe("append-only: historik och revisionslogg", () => {
  it("AuditLog kan inte ändras eller raderas", async () => {
    const { admin } = await setup();
    const row = await db.auditLog.create({ data: { actorId: admin.id, action: "TEST", entityType: "Test" } });
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "X" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it("ShiftAssignmentHistory och WorkTimeCorrection kan inte ändras", async () => {
    const { admin, erik, lisa } = await setup();
    const past = await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-03", from: "11:00", to: "15:00" });
    const hist = await db.shiftAssignmentHistory.create({
      data: { shiftId: past.id, fromEmployeeId: erik.id, toEmployeeId: lisa.id, reason: "SHIFT_SWAP", changedById: admin.id },
    });
    await expect(db.shiftAssignmentHistory.delete({ where: { id: hist.id } })).rejects.toThrow(/append-only/);

    const entry = await db.workTimeEntry.create({
      data: {
        shiftId: past.id,
        employeeId: erik.id,
        workDate: past.localDate,
        category: "GOLFSHOP",
        source: "SCHEDULE",
        scheduledStartsAt: past.startsAt,
        scheduledEndsAt: past.endsAt,
        scheduledMinutes: 240,
        registeredMinutes: 240,
      },
    });
    const corr = await db.workTimeCorrection.create({
      data: {
        workTimeEntryId: entry.id,
        previousApprovedMinutes: null,
        newApprovedMinutes: 230,
        previousStatus: "PRELIMINARY",
        newStatus: "CORRECTED",
        reason: "Gick tidigt",
        correctedById: admin.id,
      },
    });
    await expect(db.workTimeCorrection.update({ where: { id: corr.id }, data: { reason: "x" } })).rejects.toThrow(/append-only/);
  });
});

describe("övriga constraints", () => {
  it("e-post måste vara gemener", async () => {
    await expect(
      db.user.create({ data: { email: "Versal@Test.Example", passwordHash: "x", role: "ADMIN" } }),
    ).rejects.toThrow(/User_email_lowercase_chk|check/i);
  });

  it("notislänkar måste vara interna sökvägar", async () => {
    const { admin } = await setup();
    const base = { userId: admin.id, type: "SHIFT_CHANGED" as const, title: "x" };
    await expect(db.notification.create({ data: { ...base, linkPath: "https://evil.example" } })).rejects.toThrow(/Notification_link_internal_chk|check/i);
    await expect(db.notification.create({ data: { ...base, linkPath: "//evil.example" } })).rejects.toThrow(/Notification_link_internal_chk|check/i);
    await expect(db.notification.create({ data: { ...base, linkPath: "/admin/dagsavslut" } })).resolves.toBeTruthy();
  });

  it("historiska poster kan inte raderas via sin anställd (Restrict)", async () => {
    const { admin, erik } = await setup();
    await makeShift(db, { employeeId: erik.id, createdById: admin.id, date: "2026-11-28", from: "11:00", to: "15:00" });
    await expect(db.employee.delete({ where: { id: erik.id } })).rejects.toThrow();
  });
});
