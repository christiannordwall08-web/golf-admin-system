import { beforeEach, describe, expect, it } from "vitest";
import { localToInstant } from "@/domain/time";
import { type Pt, interiorPoint, offsetPoint } from "@/modules/bollplockare/domain/geo";
import { clockIn, clockOut, getMyClockState, reportPosition } from "@/modules/bollplockare/server/clock";
import { getBollplockareLive } from "@/modules/bollplockare/server/live";
import {
  approveWorkEntry,
  correctWorkEntry,
  getWorkEntryDetail,
  listMyWorkEntries,
  listWorkEntries,
  summarizeByEmployee,
  workEntriesToCsv,
} from "@/modules/bollplockare/server/reports";
import { scheduleBollplockare } from "@/modules/bollplockare/server/scheduling";
import { getSettings, saveWorkArea, setDayOverride } from "@/modules/bollplockare/server/settings";
import { purgeOldPositions, runBollplockareSweeps } from "@/modules/bollplockare/server/sweeps";
import { authenticate } from "@/server/auth/login";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createEmployeeAccount, generatePersonalCode, resetPersonalCode } from "@/server/services/accounts";
import { listMyNotifications } from "@/server/services/notifications";
import { createShift } from "@/server/services/shifts";
import { makeAdmin, makeEmployee, resetDb, testDb } from "./helpers";

const db = testDb();
const SW: Pt = [59.0, 15.0];
const NW = offsetPoint(SW, 300, 0);
const NE = offsetPoint(NW, 400, 90);
const SE = offsetPoint(NE, 300, 180);
const RING = [SW, NW, NE, SE];
const inside = interiorPoint([RING]);
const east = (m: number): Pt => offsetPoint(offsetPoint(SE, 150, 0), m, 90);
const pos = (p: Pt, accuracyM = 8) => ({ kind: "position" as const, lat: p[0], lng: p[1], accuracyM, fixAt: null });
const at = (date: string, time: string, sec = 0) => new Date(localToInstant(date, time).getTime() + sec * 1000);

// Datum långt bakåt så att databasens egen klocka (now()) alltid ligger efter utcheckningen när Admin godkänner.
const D = "2026-11-10";
const SETUP = new Date("2026-11-01T10:00:00Z");

beforeEach(async () => {
  await resetDb(db);
});

async function world() {
  const adminUser = await makeAdmin(db, "Adam");
  const admin = { id: adminUser.id, role: "ADMIN" as const };
  const erik = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson", category: "BOLLPLOCKARE" });
  const olle = await makeEmployee(db, { firstName: "Olle", lastName: "Berg", category: "BOLLPLOCKARE" });
  const lisa = await makeEmployee(db, { firstName: "Lisa", lastName: "Golf", category: "GOLFSHOP" });
  await saveWorkArea(db, admin, { polygons: [RING.map((p) => [...p])], marginMeters: 40, expectedVersion: 0 });
  const r = await createShift(db, admin, { employeeId: erik.employee.id, date: D, from: "11:00", to: "15:00", publish: true, now: SETUP });
  if (!r.ok) throw new Error("setup");
  const eAct = { id: erik.user!.id, role: "BOLLPLOCKARE" as const };
  const oAct = { id: olle.user!.id, role: "BOLLPLOCKARE" as const };
  return { adminUser, admin, erik, olle, lisa, eAct, oAct, shiftId: r.shiftId };
}

async function finishedShift(w: Awaited<ReturnType<typeof world>>, out = "21:32") {
  await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
  for (const [t, s, p] of [["20:30", 0, east(60)], ["20:30", 15, east(60)], ["20:30", 30, east(60)], ["20:35", 0, inside], ["20:35", 15, inside]] as const) {
    await reportPosition(db, w.eAct, { sample: pos(p), now: at(D, t, s) });
  }
  const r = await clockOut(db, w.eAct, { now: at(D, out) });
  if (!r.ok) throw new Error("clockout");
  return r.entryId;
}

describe("påminnelser och kontroller (sweeps)", () => {
  it("påminner om kommande pass en gång, aldrig dubbelt", async () => {
    const w = await world();
    const run = () => runBollplockareSweeps(db, at(D, "18:00"));
    expect((await run()).shiftReminders).toBe(1);
    expect((await run()).shiftReminders).toBe(0);
    const n = (await listMyNotifications(db, w.erik.user!.id)).filter((x) => x.type === "SHIFT_REMINDER");
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain("20.00");
    expect(n[0].body).toContain("19.40");
    expect((await runBollplockareSweeps(db, at(D, "10:00"))).shiftReminders).toBe(0); // för tidigt
  });

  it("utebliven incheckning: admin notifieras en gång efter konfigurerad tid, inte om man klockat in", async () => {
    const w = await world();
    expect((await runBollplockareSweeps(db, at(D, "20:20"))).noShows).toBe(0); // för tidigt (stängning 20.00 + 30 min)
    expect((await runBollplockareSweeps(db, at(D, "20:35"))).noShows).toBe(1);
    expect((await runBollplockareSweeps(db, at(D, "21:00"))).noShows).toBe(0);
    const n = (await listMyNotifications(db, w.adminUser.id)).find((x) => x.type === "NO_SHOW");
    expect(n?.title).toBe("Erik Andersson har inte klockat in");

    await resetDb(db);
    const w2 = await world();
    await clockIn(db, w2.eAct, { sample: pos(inside), now: at(D, "19:45") });
    expect((await runBollplockareSweeps(db, at(D, "20:35"))).noShows).toBe(0);
  });

  it("glömd utcheckning: påminnelse till bollplockaren och admin, men passet och tiden ändras ALDRIG", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    expect((await runBollplockareSweeps(db, at(D, "22:00"))).clockOutReminders).toBe(0); // 2 h 15 min < 4 h
    const r = await runBollplockareSweeps(db, at(D, "23:50"));
    expect(r.clockOutReminders).toBe(1);
    expect((await runBollplockareSweeps(db, at(D, "23:55"))).clockOutReminders).toBe(0);
    expect((await listMyNotifications(db, w.erik.user!.id)).filter((n) => n.type === "CLOCK_OUT_REMINDER")).toHaveLength(1);
    expect((await listMyNotifications(db, w.adminUser.id)).filter((n) => n.type === "CLOCK_OUT_REMINDER")).toHaveLength(1);
    const entry = await db.workTimeEntry.findFirstOrThrow();
    expect([entry.registeredEndsAt, entry.registeredMinutes, entry.status]).toEqual([null, 0, "PRELIMINARY"]); // inget avslutat
    // utcheckning efteråt: tiden blir den verkliga och passet flaggas för granskning
    const out = await clockOut(db, w.eAct, { now: at("2026-11-11", "00:30") });
    expect(out).toMatchObject({ ok: true, registeredMinutes: 4 * 60 + 45 });
    expect((await db.bollplockareSession.findFirstOrThrow()).reviewReasons).toContain("Påmind om utcheckning");
  });

  it("GPS som inte kunnat verifieras på länge: admin uppmärksammas (ingen avvikelse, ingen paus), högst en gång i timmen", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    expect((await runBollplockareSweeps(db, at(D, "19:50"))).gpsAlerts).toBe(0);
    expect((await runBollplockareSweeps(db, at(D, "20:00"))).gpsAlerts).toBe(1);
    expect((await runBollplockareSweeps(db, at(D, "20:20"))).gpsAlerts).toBe(0);
    expect(await db.gpsPause.count()).toBe(0);
    expect((await listMyNotifications(db, w.adminUser.id)).filter((n) => n.type === "GPS_UNVERIFIED")).toHaveLength(1);
  });

  it("koordinater i gamla pauser rensas efter lagringstiden, avstånd och tider finns kvar", async () => {
    const w = await world();
    const entryId = await finishedShift(w);
    const session = await db.bollplockareSession.findFirstOrThrow({ where: { entryId } });
    const pause = await db.gpsPause.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(pause.lat).not.toBeNull();
    const retention = (await getSettings(db)).gpsRetentionDays;
    expect(await purgeOldPositions(db, new Date(pause.createdAt.getTime() + (retention - 1) * 86_400_000), retention)).toBe(0);
    expect(await purgeOldPositions(db, new Date(pause.createdAt.getTime() + (retention + 1) * 86_400_000), retention)).toBe(1);
    const after = await db.gpsPause.findFirstOrThrow();
    expect([after.lat, after.lng, after.accuracyM]).toEqual([null, null, null]);
    expect(after.distanceM).not.toBeNull();
    expect(after.startedAt).toEqual(pause.startedAt);
  });
});

describe("granska, godkänn och korrigera arbetstid", () => {
  it("godkänna ger godkänd tid = registrerad tid, och registreringen låses mot dubbelgodkännande", async () => {
    const w = await world();
    const id = await finishedShift(w);
    await approveWorkEntry(db, w.admin, id);
    await approveWorkEntry(db, w.admin, id); // idempotent
    const e = await db.workTimeEntry.findUniqueOrThrow({ where: { id } });
    expect([e.status, e.approvedMinutes, e.approvedById]).toEqual(["APPROVED", 102, w.adminUser.id]);
    expect((await db.bollplockareSession.findFirstOrThrow()).needsReview).toBe(false);
    expect(await db.auditLog.count({ where: { action: "WORKTIME_APPROVED" } })).toBe(1);
  });

  it("pågående pass kan inte godkännas; bollplockare kan inte godkänna eller korrigera", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    const open = await db.workTimeEntry.findFirstOrThrow();
    await expect(approveWorkEntry(db, w.admin, open.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(approveWorkEntry(db, w.eAct, open.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(correctWorkEntry(db, w.eAct, open.id, { expectedVersion: 1, reason: "Jag vill ändra", endedAt: at(D, "20:00") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(correctWorkEntry(db, w.admin, open.id, { expectedVersion: 1, reason: "Pågår fortfarande" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("korrigering: ursprungligt värde, nytt värde, anledning, vem och när sparas, och bollplockaren får en notis", async () => {
    const w = await world();
    const id = await finishedShift(w, "21:32");
    const before = await db.workTimeEntry.findUniqueOrThrow({ where: { id } });
    const r = await correctWorkEntry(db, w.admin, id, { expectedVersion: before.version, reason: "Glömde klocka ut, var klar 21.05", endedAt: at(D, "21:05"), now: at("2026-11-12", "10:00") });
    expect(r).toEqual({ registeredMinutes: 80 - 5, pausedMinutes: 5 });

    const e = await db.workTimeEntry.findUniqueOrThrow({ where: { id } });
    expect([e.status, e.approvedMinutes, e.registeredMinutes, e.registeredEndsAt]).toEqual(["CORRECTED", 75, 75, at(D, "21:05")]);
    const c = await db.workTimeCorrection.findFirstOrThrow({ where: { workTimeEntryId: id } });
    expect(c).toMatchObject({ previousApprovedMinutes: null, newApprovedMinutes: 75, previousStatus: "PRELIMINARY", newStatus: "CORRECTED", reason: "Glömde klocka ut, var klar 21.05", correctedById: w.adminUser.id });
    expect(c.createdAt).toBeInstanceOf(Date);
    expect((c.detail as { endedAt: string[]; registeredMinutes: number[] }).endedAt).toEqual([at(D, "21:32").toISOString(), at(D, "21:05").toISOString()]);
    expect((c.detail as { registeredMinutes: number[] }).registeredMinutes).toEqual([102, 75]);
    expect(await db.gpsEvent.count({ where: { type: "ADMIN_CORRECTION" } })).toBe(1);
    const n = (await listMyNotifications(db, w.erik.user!.id)).find((x) => x.type === "WORKTIME_CORRECTED");
    expect(n?.body).toContain("Glömde klocka ut");
    // ändringshistoriken är append-only
    await expect(db.workTimeCorrection.update({ where: { id: c.id }, data: { reason: "Ändrad i efterhand" } })).rejects.toThrow(/append-only/);
    await expect(db.workTimeCorrection.delete({ where: { id: c.id } })).rejects.toThrow(/append-only/);
  });

  it("ogiltiga korrigeringar avvisas: utan anledning, slut före start, framtid, för lång, gammal version", async () => {
    const w = await world();
    const id = await finishedShift(w);
    const v = (await db.workTimeEntry.findUniqueOrThrow({ where: { id } })).version;
    const base = { expectedVersion: v, now: at("2026-11-12", "10:00") };
    await expect(correctWorkEntry(db, w.admin, id, { ...base, reason: "  ", endedAt: at(D, "21:00") })).rejects.toThrow(/anledning/);
    await expect(correctWorkEntry(db, w.admin, id, { ...base, reason: "Fel tid", endedAt: at(D, "19:00") })).rejects.toThrow(/efter incheckningen/);
    await expect(correctWorkEntry(db, w.admin, id, { ...base, reason: "Fel tid", endedAt: at("2026-11-13", "10:00") })).rejects.toThrow(/framtiden/);
    await expect(correctWorkEntry(db, w.admin, id, { ...base, reason: "Fel tid", startedAt: at("2026-11-08", "10:00") })).rejects.toThrow(/24 timmar/);
    await expect(correctWorkEntry(db, w.admin, id, { ...base, reason: "Fel tid", pausedMinutes: 9999 })).rejects.toThrow(/längre än hela passet/);
    await expect(correctWorkEntry(db, w.admin, id, { ...base, reason: "Fel tid", pausedMinutes: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(correctWorkEntry(db, w.admin, id, { ...base, expectedVersion: v + 5, reason: "Fel tid", endedAt: at(D, "21:00") })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.workTimeCorrection.count()).toBe(0);
  });

  it("en geografisk paus kan ogiltigförklaras med anledning: den räknas inte längre men finns kvar i historiken", async () => {
    const w = await world();
    const id = await finishedShift(w);
    const detail = await getWorkEntryDetail(db, w.admin, id);
    const pause = detail.entry.bollplockareSession!.pauses[0];
    const v = detail.entry.version;
    const r = await correctWorkEntry(db, w.admin, id, { expectedVersion: v, reason: "Hämtade bollar utanför området (godkänt)", voidPauseIds: [pause.id], now: at("2026-11-12", "10:00") });
    expect(r).toEqual({ registeredMinutes: 107, pausedMinutes: 0 });
    const p = await db.gpsPause.findUniqueOrThrow({ where: { id: pause.id } });
    expect([p.voidedById, p.voidReason]).toEqual([w.adminUser.id, "Hämtade bollar utanför området (godkänt)"]);
    expect(await db.gpsPause.count()).toBe(1);
    await expect(correctWorkEntry(db, w.admin, id, { expectedVersion: v + 1, reason: "Okänd paus", voidPauseIds: ["finns-inte"], now: at("2026-11-12", "10:00") })).rejects.toBeInstanceOf(ValidationError);
  });

  it("en låst månad kan inte ändras", async () => {
    const w = await world();
    const id = await finishedShift(w);
    await db.monthlyPayrollReport.create({ data: { year: 2026, month: 11, status: "LOCKED" } });
    await expect(approveWorkEntry(db, w.admin, id)).rejects.toBeInstanceOf(ConflictError);
    await expect(correctWorkEntry(db, w.admin, id, { expectedVersion: 1, reason: "Försök i låst månad", endedAt: at(D, "21:00"), now: at("2026-11-12", "10:00") })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("historik, filter, månadsrapport och löneunderlag", () => {
  async function two() {
    const w = await world();
    const id1 = await finishedShift(w);
    await createShift(db, w.admin, { employeeId: w.olle.employee.id, date: "2026-11-11", from: "11:00", to: "15:00", publish: true, now: SETUP });
    await clockIn(db, w.oAct, { sample: pos(inside), now: at("2026-11-11", "19:50") });
    await clockOut(db, w.oAct, { now: at("2026-11-11", "21:20") });
    const id2 = (await db.workTimeEntry.findFirstOrThrow({ where: { employeeId: w.olle.employee.id } })).id;
    return { w, id1, id2 };
  }

  it("varje rad har namn, datum, stängningstid, in/ut, total, paus, registrerad tid och status", async () => {
    const { w } = await two();
    const rows = await listWorkEntries(db, w.admin, { from: "2026-11-01", to: "2026-11-30" });
    expect(rows.map((r) => r.employeeName)).toEqual(["Olle Berg", "Erik Andersson"]);
    const erik = rows.find((r) => r.employeeName === "Erik Andersson")!;
    expect(erik).toMatchObject({ workDate: D, closeTime: "20:00", totalMinutes: 107, pausedMinutes: 5, pauseCount: 1, registeredMinutes: 102, status: "PRELIMINARY", needsReview: true, approvedMinutes: null, open: false });
    expect(rows.find((r) => r.employeeName === "Olle Berg")).toMatchObject({ totalMinutes: 90, pausedMinutes: 0, needsReview: false, registeredMinutes: 90 });
  });

  it("filter: anställd, datum, godkända, preliminära, kräver granskning", async () => {
    const { w, id1 } = await two();
    const f = (over: object) => listWorkEntries(db, w.admin, { from: "2026-11-01", to: "2026-11-30", ...over });
    expect((await f({ employeeId: w.erik.employee.id })).map((r) => r.employeeName)).toEqual(["Erik Andersson"]);
    expect(await f({ from: "2026-11-11", to: "2026-11-11" })).toHaveLength(1);
    expect(await f({ status: "NEEDS_REVIEW" })).toHaveLength(1);
    expect(await f({ status: "PRELIMINARY" })).toHaveLength(2);
    expect(await f({ status: "APPROVED" })).toHaveLength(0);
    await approveWorkEntry(db, w.admin, id1);
    expect((await f({ status: "APPROVED" })).map((r) => r.employeeName)).toEqual(["Erik Andersson"]);
    expect(await f({ status: "NEEDS_REVIEW" })).toHaveLength(0);
  });

  it("månadsrapport per person: godkänd och preliminär tid skiljs åt, och ersättningen följer godkänd tid × timlön", async () => {
    const { w, id1 } = await two();
    await db.payRate.create({ data: { employeeId: w.erik.employee.id, hourlyRateOre: 15_000, validFrom: new Date("2026-01-01"), createdById: w.adminUser.id } });
    await approveWorkEntry(db, w.admin, id1);
    const rows = await listWorkEntries(db, w.admin, { from: "2026-11-01", to: "2026-11-30" });
    const summary = summarizeByEmployee(rows);
    const erik = summary.find((s) => s.employeeName === "Erik Andersson")!;
    expect(erik).toMatchObject({ sessions: 1, registeredMinutes: 102, approvedMinutes: 102, pendingMinutes: 0, compensationOre: 25_500 }); // 1,7 h × 150 kr
    expect(summary.find((s) => s.employeeName === "Olle Berg")).toMatchObject({ approvedMinutes: 0, pendingMinutes: 90, compensationOre: 0 });
  });

  it("CSV: namn på varje rad, svenska rubriker, decimalkomma och status", async () => {
    const { w } = await two();
    const csv = workEntriesToCsv(await listWorkEntries(db, w.admin, { from: "2026-11-01", to: "2026-11-30" }));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Anställd;Datum;Arbetskategori;Rangens stängningstid");
    expect(lines).toHaveLength(3);
    expect(lines.slice(1).every((l) => /^(Erik Andersson|Olle Berg);2026-11-1[01];Bollplockare;20:00;/.test(l))).toBe(true);
    const erik = lines.find((l) => l.startsWith("Erik"))!;
    expect(erik).toContain(";1,70;");
    expect(erik).toContain("Preliminär");
  });

  it("bollplockaren ser bara sina egna rapporter; golfshop-personal och andra nekas", async () => {
    const { w } = await two();
    const mine = await listMyWorkEntries(db, w.eAct, { from: "2026-11-01", to: "2026-11-30" });
    expect(mine.map((r) => r.employeeName)).toEqual(["Erik Andersson"]);
    await expect(listWorkEntries(db, w.eAct, { from: "2026-11-01", to: "2026-11-30" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getWorkEntryDetail(db, w.eAct, "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getBollplockareLive(db, w.eAct)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("adminens realtidsöversikt", () => {
  it("visar vem som ska arbeta, inte klockat in, arbetar, är pausad, har GPS-problem och är klar. Gammal position märks som gammal", async () => {
    const w = await world();
    await createShift(db, w.admin, { employeeId: w.olle.employee.id, date: D, from: "11:00", to: "15:00", publish: true, now: SETUP });
    const states = async (t: Date) => Object.fromEntries((await getBollplockareLive(db, w.admin, t)).people.map((p) => [p.name, p.state]));

    expect(await states(at(D, "12:00"))).toEqual({ "Erik Andersson": "SCHEDULED", "Olle Berg": "SCHEDULED" });
    expect(await states(at(D, "19:50"))).toEqual({ "Erik Andersson": "AWAITING_CHECK_IN", "Olle Berg": "AWAITING_CHECK_IN" });

    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    await clockIn(db, w.oAct, { sample: pos(inside), now: at(D, "19:46") });
    for (const s of [0, 15, 30]) await reportPosition(db, w.oAct, { sample: pos(east(90)), now: at(D, "20:00", s) });
    await reportPosition(db, w.eAct, { sample: pos(inside), now: at(D, "20:00", 40) });
    const live = await getBollplockareLive(db, w.admin, at(D, "20:00", 50));
    expect(await states(at(D, "20:00", 50))).toEqual({ "Erik Andersson": "ACTIVE", "Olle Berg": "PAUSED" });
    const erik = live.people.find((p) => p.name === "Erik Andersson")!;
    expect(erik).toMatchObject({ gps: "INSIDE", workedSeconds: 15 * 60 + 50 });
    expect(erik.position).toMatchObject({ stale: false });
    expect(live.deviations).toHaveLength(1);
    expect(live.deviations[0]).toMatchObject({ name: "Olle Berg", endedAt: null });

    // 10 minuter utan uppdatering: positionen är gammal och får inte visas som aktuell
    const later = (await getBollplockareLive(db, w.admin, at(D, "20:10"))).people.find((p) => p.name === "Erik Andersson")!;
    expect(later.gps).toBe("STALE");
    expect(later.position?.stale).toBe(true);

    // efter utcheckning finns ingen position kvar att visa
    await clockOut(db, w.eAct, { now: at(D, "21:00") });
    const done = (await getBollplockareLive(db, w.admin, at(D, "21:01"))).people.find((p) => p.name === "Erik Andersson")!;
    expect(done).toMatchObject({ state: "COMPLETED", position: null, gps: "NONE", registeredMinutes: 75 });
  });
});

describe("schemaläggning av flera, och konton", () => {
  it("flera bollplockare och flera dagar samtidigt; stängd dag, dubbletter och fel kategori hoppas över med anledning", async () => {
    const w = await world();
    await setDayOverride(db, w.admin, { date: "2026-11-13", closed: true }, SETUP);
    const r = await scheduleBollplockare(db, w.admin, { employeeIds: [w.erik.employee.id, w.olle.employee.id], dates: ["2026-11-10", "2026-11-12", "2026-11-13"], publish: true, now: SETUP });
    // Erik har redan 10:e. 13:e är stängd för båda.
    expect(r.created).toBe(3);
    expect(r.skipped.map((s) => `${s.employee} ${s.date}`).sort()).toEqual(["Erik Andersson 2026-11-13", "Erik Andersson 2026-11-10", "Olle Berg 2026-11-13"].sort());
    expect(r.skipped.find((s) => s.date === "2026-11-13")?.reason).toContain("stängd");
    await expect(scheduleBollplockare(db, w.admin, { employeeIds: [w.lisa.employee.id], dates: ["2026-11-20"] })).rejects.toThrow(/bollplockare/);
    await expect(scheduleBollplockare(db, w.eAct, { employeeIds: [w.erik.employee.id], dates: ["2026-11-20"] })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.shift.count({ where: { openEnded: true } })).toBe(4);
  });

  it("admin skapar konto med personlig kod: koden fungerar i den vanliga inloggningen, och visas bara en gång", async () => {
    const w = await world();
    expect(generatePersonalCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const r = await createEmployeeAccount(db, w.admin, { firstName: "Nils", lastName: "Nyman", email: "  Nils@Example.TEST ", category: "BOLLPLOCKARE" });
    const user = await db.user.findUniqueOrThrow({ where: { id: r.userId }, include: { employees: true } });
    expect([user.email, user.role, user.employees[0].category, user.employees[0].firstName]).toEqual(["nils@example.test", "BOLLPLOCKARE", "BOLLPLOCKARE", "Nils"]);
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user.passwordHash).not.toContain(r.code);
    expect(await authenticate(db, { email: "nils@example.test", password: r.code, audience: "EMPLOYEE" })).toMatchObject({ ok: true });
    expect(await authenticate(db, { email: "nils@example.test", password: "fel-kod-123456", audience: "EMPLOYEE" })).toMatchObject({ ok: false });
    // samma e-post två gånger, ogiltiga uppgifter och obehörig
    await expect(createEmployeeAccount(db, w.admin, { firstName: "X", lastName: "Y", email: "nils@example.test", category: "BOLLPLOCKARE" })).rejects.toThrow(/redan/);
    await expect(createEmployeeAccount(db, w.admin, { firstName: "", lastName: "Y", email: "a@b.test", category: "BOLLPLOCKARE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEmployeeAccount(db, w.admin, { firstName: "A", lastName: "B", email: "inte-en-epost", category: "BOLLPLOCKARE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEmployeeAccount(db, w.eAct, { firstName: "A", lastName: "B", email: "a@b.test", category: "BOLLPLOCKARE" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ny kod avslutar pågående inloggningar och gör den gamla koden ogiltig", async () => {
    const w = await world();
    const acc = await createEmployeeAccount(db, w.admin, { firstName: "Nils", lastName: "Nyman", email: "nils@example.test", category: "BOLLPLOCKARE" });
    await db.session.create({ data: { id: "s1", userId: acc.userId, expiresAt: new Date(Date.now() + 3_600_000) } });
    const { code } = await resetPersonalCode(db, w.admin, acc.employeeId);
    expect(code).not.toBe(acc.code);
    expect(await db.session.count({ where: { userId: acc.userId } })).toBe(0);
    expect(await authenticate(db, { email: "nils@example.test", password: acc.code, audience: "EMPLOYEE" })).toMatchObject({ ok: false });
    expect(await authenticate(db, { email: "nils@example.test", password: code, audience: "EMPLOYEE" })).toMatchObject({ ok: true });
    await expect(resetPersonalCode(db, w.eAct, acc.employeeId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("databasens egna spärrar", () => {
  it("en person kan inte ha två pågående GPS-registreringar, och historiken kan inte ändras", async () => {
    const w = await world();
    await createShift(db, w.admin, { employeeId: w.erik.employee.id, date: "2026-11-11", from: "11:00", to: "15:00", publish: true, now: SETUP });
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    const shift2 = await db.shift.findFirstOrThrow({ where: { localDate: new Date("2026-11-11") } });
    await expect(
      db.workTimeEntry.create({ data: { shiftId: shift2.id, employeeId: w.erik.employee.id, workDate: shift2.localDate, category: "BOLLPLOCKARE", source: "GPS", scheduledStartsAt: shift2.startsAt, scheduledEndsAt: shift2.endsAt, scheduledMinutes: 0, registeredStartsAt: at("2026-11-11", "19:45"), registeredMinutes: 0 } }),
    ).rejects.toThrow();
    const ev = await db.gpsEvent.findFirstOrThrow();
    await expect(db.gpsEvent.update({ where: { id: ev.id }, data: { type: "CLOCK_OUT" } })).rejects.toThrow(/append-only/);
    await expect(db.gpsEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });

  it("överlappande pauser och pauser med slut före start nekas", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    const s = await db.bollplockareSession.findFirstOrThrow();
    await db.gpsPause.create({ data: { sessionId: s.id, startedAt: at(D, "20:00"), endedAt: at(D, "20:10") } });
    await expect(db.gpsPause.create({ data: { sessionId: s.id, startedAt: at(D, "20:05"), endedAt: at(D, "20:15") } })).rejects.toThrow();
    await expect(db.gpsPause.create({ data: { sessionId: s.id, startedAt: at(D, "21:00"), endedAt: at(D, "20:50") } })).rejects.toThrow();
    await db.gpsPause.create({ data: { sessionId: s.id, startedAt: at(D, "20:30") } });
    await expect(db.gpsPause.create({ data: { sessionId: s.id, startedAt: at(D, "20:40") } })).rejects.toThrow(); // två öppna
  });

  it("ogiltiga inställningar, avvikelser och område nekas, pass utan fast sluttid bara för bollplockare", async () => {
    const w = await world();
    await expect(db.bollplockareSettings.create({ data: { id: "default", defaultCloseTime: "20:00", checkInMarginMinutes: 999 } })).rejects.toThrow();
    await expect(db.bollplockareSettings.create({ data: { id: "annat" } })).rejects.toThrow();
    await expect(db.bollplockareDayOverride.create({ data: { date: new Date("2026-12-01"), isClosed: true, closeTime: "18:00", createdById: w.adminUser.id } })).rejects.toThrow();
    await expect(db.bollplockareDayOverride.create({ data: { date: new Date("2026-12-02"), isClosed: false, createdById: w.adminUser.id } })).rejects.toThrow();
    await expect(db.gpsWorkArea.update({ where: { id: "default" }, data: { marginMeters: 9999 } })).rejects.toThrow();
    const s = await db.shift.findUniqueOrThrow({ where: { id: w.shiftId } });
    await expect(db.shift.create({ data: { scheduleId: s.scheduleId, category: "GOLFSHOP", assignedEmployeeId: w.lisa.employee.id, originalEmployeeId: w.lisa.employee.id, startsAt: s.startsAt, endsAt: s.endsAt, localDate: s.localDate, openEnded: true, createdById: w.adminUser.id } })).rejects.toThrow();
  });

  it("godkänd GPS-tid: utcheckningen får inte ligga i framtiden, men slutet på arbetsdygnet får", async () => {
    const w = await world();
    const id = await finishedShift(w);
    // schemalagt slut (arbetsdygnets slut) ligger efter utcheckningen men är inte avgörande för GPS
    await db.workTimeEntry.update({ where: { id }, data: { status: "APPROVED", approvedMinutes: 102, approvedAt: new Date(), approvedById: w.adminUser.id } });
    await expect(
      db.workTimeEntry.update({ where: { id }, data: { registeredEndsAt: new Date(Date.now() + 3_600_000) } }),
    ).rejects.toThrow(/framtida/);
  });
});

it("hela flödet: panelens tillstånd efter utcheckning visar sammanfattning", async () => {
  const w = await world();
  await finishedShift(w);
  const state = await getMyClockState(db, w.eAct, at(D, "21:40"));
  expect(state.finished).toMatchObject({ totalMinutes: 107, pausedMinutes: 5, registeredMinutes: 102, status: "PRELIMINARY" });
  expect(state.active).toBeNull();
});
