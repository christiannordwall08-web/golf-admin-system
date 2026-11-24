import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { getMyMonth } from "@/server/queries/self";
import { getScheduleMonth } from "@/server/queries/schedule";
import { cancelShift, createShift, isOverlapViolation, publishShifts, restoreShift, updateShift } from "@/server/services/shifts";
import { makeAdmin, makeEmployee, makeShift, resetDb, testDb } from "./helpers";

const db = testDb();
// Tisdag 24 nov 2026 kl 12.00 svensk tid.
const NOW = new Date("2026-11-24T11:00:00Z");

async function world() {
  const adminUser = await makeAdmin(db, "Anna Admin");
  const admin = { id: adminUser.id, role: "ADMIN" as const };
  const erik = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
  const lisa = await makeEmployee(db, { firstName: "Lisa", lastName: "Svensson" });
  const oscar = await makeEmployee(db, { firstName: "Oscar", lastName: "Nilsson", category: "BOLLPLOCKARE" });
  const staff = { id: erik.user!.id, role: "GOLFSHOP" as const };
  const base = { date: "2026-11-28", from: "11:00", to: "15:00", now: NOW };
  return { adminUser, admin, erik, lisa, oscar, staff, base };
}

beforeEach(async () => {
  await resetDb(db);
});

describe("createShift", () => {
  it("Test 1: skapar ett utkast för Erik 28 nov 11–15 med rätt namn, tider, historik och revisionslogg", async () => {
    const { admin, erik, base } = await world();
    const r = await createShift(db, admin, { employeeId: erik.employee.id, ...base });
    expect(r).toMatchObject({ ok: true, category: "GOLFSHOP" });
    const shift = await db.shift.findFirstOrThrow({
      include: { assignedEmployee: true, schedule: true, assignmentHistory: true },
    });
    expect([shift.assignedEmployee.firstName, shift.localDate.toISOString().slice(0, 10)]).toEqual(["Erik", "2026-11-28"]);
    expect([shift.startsAt.toISOString(), shift.endsAt.toISOString()]).toEqual(["2026-11-28T10:00:00.000Z", "2026-11-28T14:00:00.000Z"]);
    expect([shift.publicationStatus, shift.approvalStatus, shift.workStatus, shift.version]).toEqual(["DRAFT", "PENDING", "SCHEDULED", 1]);
    expect(shift.originalEmployeeId).toBe(shift.assignedEmployeeId);
    expect([shift.schedule.category, shift.schedule.year, shift.schedule.month, shift.schedule.status]).toEqual(["GOLFSHOP", 2026, 11, "DRAFT"]);
    expect(shift.assignmentHistory.map((h) => h.reason)).toEqual(["INITIAL"]);
    expect(await db.auditLog.count({ where: { action: "SHIFT_CREATED", actorId: admin.id, entityId: shift.id } })).toBe(1);
  });

  it("Test 2: Erik och Lisa samma dag och tid går bra (olika personer)", async () => {
    const { admin, erik, lisa, base } = await world();
    await createShift(db, admin, { employeeId: erik.employee.id, ...base });
    const r = await createShift(db, admin, { employeeId: lisa.employee.id, ...base });
    expect(r.ok).toBe(true);
    const shifts = await getScheduleMonth(db, admin, { year: 2026, month: 11, now: NOW });
    expect(shifts.map((s) => s.employeeName)).toEqual(["Erik Andersson", "Lisa Svensson"]);
  });

  it("'Publicera direkt' ger ett publicerat pass och ett publicerat månadsschema", async () => {
    const { admin, erik, base } = await world();
    await createShift(db, admin, { employeeId: erik.employee.id, ...base, publish: true });
    const shift = await db.shift.findFirstOrThrow({ include: { schedule: true } });
    expect([shift.publicationStatus, shift.schedule.status]).toEqual(["PUBLISHED", "PUBLISHED"]);
  });

  it("kategorin följer personen: Oscar (Bollplockare) hamnar i Schema B", async () => {
    const { admin, oscar, base } = await world();
    const r = await createShift(db, admin, { employeeId: oscar.employee.id, ...base });
    expect(r).toMatchObject({ ok: true, category: "BOLLPLOCKARE" });
    expect((await db.shift.findFirstOrThrow({ include: { schedule: true } })).schedule.category).toBe("BOLLPLOCKARE");
  });

  it("nekar överlapp för samma person men tillåter pass som ligger direkt efter varandra", async () => {
    const { admin, erik, base } = await world();
    await createShift(db, admin, { employeeId: erik.employee.id, ...base }); // 11–15
    const clash = await createShift(db, admin, { employeeId: erik.employee.id, ...base, from: "14:00", to: "18:00" });
    expect(clash).toMatchObject({ ok: false, needsConfirm: false });
    expect(clash.ok === false && clash.issues[0]).toMatchObject({ code: "OVERLAP", severity: "error" });
    expect(await db.shift.count()).toBe(1);
    expect((await createShift(db, admin, { employeeId: erik.employee.id, ...base, from: "15:00", to: "19:00" })).ok).toBe(true);
  });

  it("nekar felaktiga tider, och slutar-nästa-dag måste anges uttryckligen", async () => {
    const { admin, erik, base } = await world();
    const inverted = await createShift(db, admin, { employeeId: erik.employee.id, ...base, from: "15:00", to: "11:00" });
    expect(inverted.ok === false && inverted.issues[0].code).toBe("INVALID_TIMES");
    expect(await db.shift.count()).toBe(0);
    const night = await createShift(db, admin, { employeeId: erik.employee.id, date: "2026-12-05", from: "22:00", to: "06:00", endsNextDay: true, now: NOW });
    expect(night.ok).toBe(true);
    const s = await db.shift.findFirstOrThrow();
    expect((s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000).toBe(8);
  });

  it("nattpass över vintertidsbytet (24 → 25 okt) lagras som 9 timmar (verklig tid)", async () => {
    const { admin, erik } = await world();
    await createShift(db, admin, { employeeId: erik.employee.id, date: "2026-10-24", from: "22:00", to: "06:00", endsNextDay: true, now: new Date("2026-10-01T00:00:00Z") });
    const s = await db.shift.findFirstOrThrow();
    expect((s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000).toBe(9);
  });

  it("nekar inaktiv och okänd person", async () => {
    const { admin, erik, base } = await world();
    await db.employee.update({ where: { id: erik.employee.id }, data: { status: "INACTIVE" } });
    const r = await createShift(db, admin, { employeeId: erik.employee.id, ...base });
    expect(r.ok === false && r.issues.map((i) => i.code)).toEqual(["EMPLOYEE_INACTIVE"]);
    await expect(createShift(db, admin, { employeeId: "finns-inte", ...base })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("pass i det förflutna kräver bekräftelse (påverkar genomförda timmar)", async () => {
    const { admin, erik } = await world();
    const input = { employeeId: erik.employee.id, date: "2026-11-03", from: "11:00", to: "15:00", now: NOW };
    const first = await createShift(db, admin, input);
    expect(first).toMatchObject({ ok: false, needsConfirm: true });
    expect(first.ok === false && first.issues[0].code).toBe("ALREADY_ENDED");
    expect(await db.shift.count()).toBe(0);
    expect((await createShift(db, admin, { ...input, confirmWarnings: true })).ok).toBe(true);
  });

  it("Test 10: personal får inte skapa pass (servern nekar och inget skrivs)", async () => {
    const { staff, erik, base } = await world();
    await expect(createShift(db, staff, { employeeId: erik.employee.id, ...base })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.shift.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "SHIFT_CREATED" } })).toBe(0);
  });

  it("pass som börjar 1 dec hör till decemberschemat", async () => {
    const { admin, erik } = await world();
    await createShift(db, admin, { employeeId: erik.employee.id, date: "2026-12-01", from: "09:00", to: "13:00", now: NOW });
    const s = await db.shift.findFirstOrThrow({ include: { schedule: true } });
    expect([s.schedule.year, s.schedule.month]).toEqual([2026, 12]);
  });

  it("överlappsfelet från databasen känns igen (skyddsnät vid samtidig skrivning)", async () => {
    const { adminUser, erik } = await world();
    await makeShift(db, { employeeId: erik.employee.id, createdById: adminUser.id, date: "2026-11-28", from: "11:00", to: "15:00" });
    const err = await makeShift(db, { employeeId: erik.employee.id, createdById: adminUser.id, date: "2026-11-28", from: "12:00", to: "16:00" }).catch((e) => e);
    expect(isOverlapViolation(err)).toBe(true);
    expect(isOverlapViolation(new Error("något annat"))).toBe(false);
  });
});

describe("updateShift", () => {
  async function created(approved = false) {
    const w = await world();
    const r = await createShift(db, w.admin, { employeeId: w.erik.employee.id, ...w.base, publish: approved });
    if (!r.ok) throw new Error("setup");
    if (approved) await db.shift.update({ where: { id: r.shiftId }, data: { approvalStatus: "APPROVED" } });
    const shift = await db.shift.findUniqueOrThrow({ where: { id: r.shiftId } });
    return { ...w, shift };
  }
  const same = (s: { assignedEmployeeId: string; version: number }) => ({ employeeId: s.assignedEmployeeId, date: "2026-11-28", from: "11:00", to: "15:00", expectedVersion: s.version, now: NOW });

  it("ändrar tid och notering, ökar version och loggar före/efter", async () => {
    const { admin, shift } = await created();
    const r = await updateShift(db, admin, shift.id, { ...same(shift), to: "16:00", notes: "öppnar" });
    expect(r.ok).toBe(true);
    const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect([after.endsAt.toISOString(), after.notes, after.version]).toEqual(["2026-11-28T15:00:00.000Z", "öppnar", 2]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "SHIFT_UPDATED" } });
    expect(log).toMatchObject({ actorId: admin.id, entityId: shift.id });
    expect((log.before as { endsAt: string }).endsAt).toBe("2026-11-28T14:00:00.000Z");
    expect((log.after as { endsAt: string }).endsAt).toBe("2026-11-28T15:00:00.000Z");
  });

  it("ingen ändring = inget skrivs (version och logg orörda)", async () => {
    const { admin, shift } = await created();
    expect((await updateShift(db, admin, shift.id, same(shift))).ok).toBe(true);
    expect((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).version).toBe(1);
    expect(await db.auditLog.count({ where: { action: "SHIFT_UPDATED" } })).toBe(0);
  });

  it("samtidiga ändringar: en gammal version nekas (ConflictError) och skriver inget", async () => {
    const { admin, shift } = await created();
    await updateShift(db, admin, shift.id, { ...same(shift), to: "16:00" }); // version 1 -> 2
    await expect(updateShift(db, admin, shift.id, { ...same(shift), to: "17:00" })).rejects.toBeInstanceOf(ConflictError);
    expect((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).endsAt.toISOString()).toBe("2026-11-28T15:00:00.000Z");
  });

  it("Test 5 (admin): byte av person loggas, ursprunglig person bevaras och ansvarig blir Lisa", async () => {
    const { admin, adminUser, shift, erik, lisa } = await created();
    await updateShift(db, admin, shift.id, { ...same(shift), employeeId: lisa.employee.id });
    const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id }, include: { assignmentHistory: { orderBy: { createdAt: "asc" } } } });
    expect([after.assignedEmployeeId, after.originalEmployeeId]).toEqual([lisa.employee.id, erik.employee.id]);
    expect(after.assignmentHistory.map((h) => [h.reason, h.fromEmployeeId, h.toEmployeeId, h.changedById])).toEqual([
      ["INITIAL", null, erik.employee.id, adminUser.id],
      ["ADMIN_REASSIGNMENT", erik.employee.id, lisa.employee.id, adminUser.id],
    ]);
  });

  it("nekar byte till en person som redan har ett överlappande pass, och till fel arbetskategori", async () => {
    const { admin, adminUser, shift, lisa, oscar } = await created();
    await makeShift(db, { employeeId: lisa.employee.id, createdById: adminUser.id, date: "2026-11-28", from: "13:00", to: "17:00" });
    const clash = await updateShift(db, admin, shift.id, { ...same(shift), employeeId: lisa.employee.id });
    expect(clash.ok === false && clash.issues.map((i) => i.code)).toEqual(["OVERLAP"]);
    const wrong = await updateShift(db, admin, shift.id, { ...same(shift), employeeId: oscar.employee.id });
    expect(wrong.ok === false && wrong.issues.map((i) => i.code)).toEqual(["CATEGORY_MISMATCH"]);
    expect((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).version).toBe(1);
  });

  it("godkänt pass: väsentlig ändring kräver bekräftelse och ger nytt godkännande, en ren notering gör det inte", async () => {
    const { admin, shift } = await created(true);
    expect(shift.approvalStatus).toBe("APPROVED");

    const note = await updateShift(db, admin, shift.id, { ...same(shift), notes: "ta med nycklar" });
    expect(note.ok).toBe(true);
    const afterNote = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(afterNote.approvalStatus).toBe("APPROVED");

    const moved = { ...same(afterNote), from: "12:00", to: "16:00", notes: "ta med nycklar" };
    const warn = await updateShift(db, admin, shift.id, moved);
    expect(warn).toMatchObject({ ok: false, needsConfirm: true });
    expect(warn.ok === false && warn.issues[0].code).toBe("APPROVED_SHIFT_CHANGED");
    expect((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).approvalStatus).toBe("APPROVED"); // inget skrevs

    expect((await updateShift(db, admin, shift.id, { ...moved, confirmWarnings: true })).ok).toBe(true);
    expect((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).approvalStatus).toBe("PENDING");
  });

  it("flytt till en annan månad byter månadsschema", async () => {
    const { admin, shift } = await created();
    await updateShift(db, admin, shift.id, { ...same(shift), date: "2026-12-02" });
    const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id }, include: { schedule: true } });
    expect([after.schedule.year, after.schedule.month, after.localDate.toISOString().slice(0, 10)]).toEqual([2026, 12, "2026-12-02"]);
  });

  it("ett pass som redan genomförts kräver bekräftelse vid tidsändring", async () => {
    const { admin, adminUser, erik } = await world();
    const past = await makeShift(db, { employeeId: erik.employee.id, createdById: adminUser.id, date: "2026-11-03", from: "09:00", to: "17:00" });
    const input = { employeeId: erik.employee.id, date: "2026-11-03", from: "11:00", to: "15:00", expectedVersion: past.version, now: NOW };
    const warn = await updateShift(db, admin, past.id, input);
    expect(warn).toMatchObject({ ok: false, needsConfirm: true });
    expect(warn.ok === false && warn.issues[0].code).toBe("ALREADY_ENDED");
    expect((await updateShift(db, admin, past.id, { ...input, confirmWarnings: true })).ok).toBe(true);
  });

  it("pass med tidsregistrering kan inte ändras (Etapp 4 hanterar korrigeringar)", async () => {
    const { admin, adminUser, erik } = await world();
    const past = await makeShift(db, { employeeId: erik.employee.id, createdById: adminUser.id, date: "2026-11-03", from: "11:00", to: "15:00" });
    await db.workTimeEntry.create({
      data: { shiftId: past.id, employeeId: erik.employee.id, workDate: past.localDate, category: "GOLFSHOP", source: "SCHEDULE", scheduledStartsAt: past.startsAt, scheduledEndsAt: past.endsAt, scheduledMinutes: 240, registeredMinutes: 240 },
    });
    const input = { employeeId: erik.employee.id, date: "2026-11-03", from: "10:00", to: "15:00", expectedVersion: past.version, now: NOW, confirmWarnings: true };
    const r = await updateShift(db, admin, past.id, input);
    expect(r.ok === false && r.issues[0].code).toBe("HAS_TIME_ENTRY");
    const c = await cancelShift(db, admin, past.id, { expectedVersion: past.version, now: NOW, confirmWarnings: true });
    expect(c.ok === false && c.issues[0].code).toBe("HAS_TIME_ENTRY");
  });

  it("SÄKERHET: personal får inte ändra pass, och okänt pass ger NotFound", async () => {
    const { shift, staff } = await created();
    await expect(updateShift(db, staff, shift.id, { ...same(shift), to: "17:00" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelShift(db, staff, shift.id, { expectedVersion: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).version).toBe(1);
    const { admin } = await world();
    await expect(updateShift(db, admin, "finns-inte", { ...same(shift) })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("cancelShift och restoreShift – pass raderas aldrig", () => {
  it("ställer in ett pass (Inställt), som då inte räknas som arbetstid, och kan återställas", async () => {
    const { admin, erik, base } = await world();
    const r = await createShift(db, admin, { employeeId: erik.employee.id, ...base });
    if (!r.ok) throw new Error("setup");
    const shift = await db.shift.findUniqueOrThrow({ where: { id: r.shiftId } });

    expect((await cancelShift(db, admin, shift.id, { expectedVersion: 1, reason: "Sjuk", now: NOW })).ok).toBe(true);
    const cancelled = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect([cancelled.workStatus, cancelled.version]).toEqual(["CANCELLED", 2]);
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(await db.shift.count()).toBe(1); // raderad är den inte
    expect(await db.auditLog.count({ where: { action: "SHIFT_CANCELLED" } })).toBe(1);

    // inställt pass kan inte ändras, och inte ställas in igen
    const edit = await updateShift(db, admin, shift.id, { employeeId: erik.employee.id, ...base, expectedVersion: 2 });
    expect(edit.ok === false && edit.issues[0].code).toBe("SHIFT_CANCELLED");

    expect((await restoreShift(db, admin, shift.id, { expectedVersion: 2, now: NOW })).ok).toBe(true);
    const restored = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect([restored.workStatus, restored.cancelledAt, restored.version]).toEqual(["SCHEDULED", null, 3]);
  });

  it("ett inställt pass frigör tiden: personen kan få ett nytt pass då, och återställning nekas vid överlapp", async () => {
    const { admin, erik, base } = await world();
    const a = await createShift(db, admin, { employeeId: erik.employee.id, ...base });
    if (!a.ok) throw new Error("setup");
    await cancelShift(db, admin, a.shiftId, { expectedVersion: 1, now: NOW });
    const b = await createShift(db, admin, { employeeId: erik.employee.id, ...base, from: "12:00", to: "16:00" });
    expect(b.ok).toBe(true);
    const restore = await restoreShift(db, admin, a.shiftId, { expectedVersion: 2, now: NOW });
    expect(restore.ok === false && restore.issues[0].code).toBe("OVERLAP");
    expect((await db.shift.findUniqueOrThrow({ where: { id: a.shiftId } })).workStatus).toBe("CANCELLED");
  });

  it("ställa in ett genomfört pass kräver bekräftelse, och gammal version ger ConflictError", async () => {
    const { admin, adminUser, erik } = await world();
    const past = await makeShift(db, { employeeId: erik.employee.id, createdById: adminUser.id, date: "2026-11-03", from: "11:00", to: "15:00" });
    expect(await cancelShift(db, admin, past.id, { expectedVersion: 1, now: NOW })).toMatchObject({ ok: false, needsConfirm: true });
    await expect(cancelShift(db, admin, past.id, { expectedVersion: 7, now: NOW, confirmWarnings: true })).rejects.toBeInstanceOf(ConflictError);
    expect((await cancelShift(db, admin, past.id, { expectedVersion: 1, now: NOW, confirmWarnings: true })).ok).toBe(true);
  });
});

describe("publishShifts – personalen ser bara publicerade pass", () => {
  it("publicerar utkast för en kategori och månad, men inte inställda pass eller andra grupper", async () => {
    const { admin, erik, lisa, oscar, base } = await world();
    const a = await createShift(db, admin, { employeeId: erik.employee.id, ...base });
    const b = await createShift(db, admin, { employeeId: lisa.employee.id, ...base });
    await createShift(db, admin, { employeeId: oscar.employee.id, ...base }); // Bollplockare
    if (!a.ok || !b.ok) throw new Error("setup");
    await cancelShift(db, admin, b.shiftId, { expectedVersion: 1, now: NOW });

    expect(await publishShifts(db, admin, { category: "GOLFSHOP", year: 2026, month: 11, now: NOW })).toEqual({ published: 1 });
    const shifts = await db.shift.findMany({ include: { schedule: true }, orderBy: { createdAt: "asc" } });
    expect(shifts.map((s) => [s.category, s.publicationStatus])).toEqual([["GOLFSHOP", "PUBLISHED"], ["GOLFSHOP", "DRAFT"], ["BOLLPLOCKARE", "DRAFT"]]);
    expect(shifts[0].schedule.status).toBe("PUBLISHED");
    expect(shifts[0].version).toBe(2);
    expect(await db.schedulePublication.findFirstOrThrow()).toMatchObject({ shiftCount: 1, publishedById: admin.id });
    expect(await db.auditLog.count({ where: { action: "SCHEDULE_PUBLISHED" } })).toBe(1);

    // igen: inget kvar att publicera
    expect(await publishShifts(db, admin, { category: "GOLFSHOP", year: 2026, month: 11, now: NOW })).toEqual({ published: 0 });
    expect(await db.schedulePublication.count()).toBe(1);
    // månad utan schema
    expect(await publishShifts(db, admin, { category: "GOLFSHOP", year: 2027, month: 1, now: NOW })).toEqual({ published: 0 });
  });

  it("SÄKERHET: personal får inte publicera", async () => {
    const { staff } = await world();
    await expect(publishShifts(db, staff, { category: "GOLFSHOP", year: 2026, month: 11 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hela kedjan: ett nytt pass syns INTE för den anställde som utkast, men syns efter publicering", async () => {
    const { admin, erik, base } = await world();
    const r = await createShift(db, admin, { employeeId: erik.employee.id, ...base });
    if (!r.ok) throw new Error("setup");
    const me = { id: erik.user!.id, role: "GOLFSHOP" as const };
    const input = { userId: erik.user!.id, employeeId: erik.employee.id, year: 2026, month: 11, now: NOW };
    expect((await getMyMonth(db, me, input)).shifts).toHaveLength(0);
    await publishShifts(db, admin, { category: "GOLFSHOP", year: 2026, month: 11, now: NOW });
    const mine = await getMyMonth(db, me, input);
    expect(mine.shifts.map((s) => s.localDate)).toEqual(["2026-11-28"]);
    expect(mine.next?.localDate).toBe("2026-11-28");
  });
});
