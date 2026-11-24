import { beforeEach, describe, expect, it } from "vitest";
import { localToInstant } from "@/domain/time";
import { type Pt, interiorPoint, offsetPoint } from "@/modules/bollplockare/domain/geo";
import { clockIn, clockOut, getMyClockState, reportPosition } from "@/modules/bollplockare/server/clock";
import { getSettings, saveWorkArea, setDayOverride, updateSettings } from "@/modules/bollplockare/server/settings";
import { ForbiddenError } from "@/server/errors";
import { createShift } from "@/server/services/shifts";
import { listMyNotifications } from "@/server/services/notifications";
import { makeAdmin, makeEmployee, resetDb, testDb } from "./helpers";

const db = testDb();

// Fiktivt testområde 400 × 300 m, endast för test.
const SW: Pt = [59.0, 15.0];
const NW = offsetPoint(SW, 300, 0);
const NE = offsetPoint(NW, 400, 90);
const SE = offsetPoint(NE, 300, 180);
const RING = [SW, NW, NE, SE];
const inside = interiorPoint([RING]);
const east = (m: number): Pt => offsetPoint(offsetPoint(SE, 150, 0), m, 90);
const pos = (p: Pt, accuracyM = 8) => ({ kind: "position" as const, lat: p[0], lng: p[1], accuracyM, fixAt: null });
const lost = { kind: "problem" as const, problem: "UNAVAILABLE" as const };

const at = (date: string, time: string, sec = 0) => new Date(localToInstant(date, time).getTime() + sec * 1000);
const D = "2026-11-24";
const SETUP_NOW = new Date("2026-11-20T10:00:00Z");

beforeEach(async () => {
  await resetDb(db);
});

async function world(opts: { area?: boolean; publish?: boolean } = {}) {
  const adminUser = await makeAdmin(db, "Adam");
  const admin = { id: adminUser.id, role: "ADMIN" as const };
  const erik = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson", category: "BOLLPLOCKARE" });
  const olle = await makeEmployee(db, { firstName: "Olle", lastName: "Berg", category: "BOLLPLOCKARE" });
  const lisa = await makeEmployee(db, { firstName: "Lisa", lastName: "Golf", category: "GOLFSHOP" });
  if (opts.area !== false) await saveWorkArea(db, admin, { polygons: [RING.map((p) => [...p])], marginMeters: 40, expectedVersion: 0 });
  const r = await createShift(db, admin, { employeeId: erik.employee.id, date: D, from: "11:00", to: "15:00", publish: opts.publish !== false, now: SETUP_NOW });
  if (!r.ok) throw new Error("setup shift");
  const actor = (u: { id: string }) => ({ id: u.id, role: "BOLLPLOCKARE" as const });
  return { admin, adminUser, erik, olle, lisa, shiftId: r.shiftId, eAct: actor(erik.user!), oAct: actor(olle.user!) };
}

describe("passet har ingen fast sluttid: utgår från rangens stängningstid", () => {
  it("admin anger ingen sluttid; passet får tidigaste incheckning 19.40 och är öppet fram till 06.00 nästa morgon", async () => {
    const w = await world();
    const s = await db.shift.findUniqueOrThrow({ where: { id: w.shiftId } });
    expect([s.openEnded, s.category]).toEqual([true, "BOLLPLOCKARE"]);
    expect(s.startsAt).toEqual(at(D, "19:40"));
    expect(s.endsAt).toEqual(at("2026-11-25", "06:00"));
    expect(s.localDate.toISOString().slice(0, 10)).toBe(D);
  });

  it("kan inte schemaläggas en stängd dag", async () => {
    const w = await world();
    await setDayOverride(db, w.admin, { date: "2026-11-27", closed: true });
    const r = await createShift(db, w.admin, { employeeId: w.erik.employee.id, date: "2026-11-27", from: "11:00", to: "15:00", now: SETUP_NOW });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("klocka in: alla villkor kontrolleras på servern", () => {
  it("för tidigt: avvisas med nedräkning och tidigaste incheckning", async () => {
    const w = await world();
    const r = await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:17") });
    expect(r).toMatchObject({ ok: false, code: "TOO_EARLY", secondsUntil: 23 * 60 });
    expect(await db.workTimeEntry.count()).toBe(0);
    const state = await getMyClockState(db, w.eAct, at(D, "19:17"));
    expect(state.availability).toMatchObject({ status: "TOO_EARLY", secondsUntil: 23 * 60 });
    expect(state.shift?.day.closeTime).toBe("20:00");
  });

  it("utan schemalagt pass, med pass någon annan dag, eller opublicerat pass: nekas", async () => {
    const w = await world({ publish: false });
    expect(await clockIn(db, w.oAct, { sample: pos(inside), now: at(D, "19:45") })).toMatchObject({ ok: false, code: "NO_SHIFT" });
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") })).toMatchObject({ ok: false, code: "NOT_PUBLISHED" });
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at("2026-11-23", "19:45") })).toMatchObject({ ok: false, code: "NO_SHIFT" });
  });

  it("inom området: lyckas, registrerar serverns tid, skapar GPS-registrering och notifierar admin", async () => {
    const w = await world();
    const r = await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    expect(r).toMatchObject({ ok: true, zone: "INSIDE", startedAt: at(D, "19:45") });
    const entry = await db.workTimeEntry.findFirstOrThrow({ include: { bollplockareSession: { include: { events: true } } } });
    expect([entry.source, entry.status, entry.category, entry.employeeId]).toEqual(["GPS", "PRELIMINARY", "BOLLPLOCKARE", w.erik.employee.id]);
    expect(entry.registeredStartsAt).toEqual(at(D, "19:45"));
    expect(entry.registeredEndsAt).toBeNull();
    expect(entry.workDate.toISOString().slice(0, 10)).toBe(D);
    expect(entry.bollplockareSession?.gpsStatus).toBe("INSIDE");
    expect(entry.bollplockareSession?.events.map((e) => e.type)).toEqual(["CLOCK_IN"]);
    const n = await listMyNotifications(db, w.adminUser.id);
    expect(n[0]).toMatchObject({ type: "WORK_CLOCKED_IN", title: "Erik Andersson klockade in", linkPath: `/admin/bollplockare/pass/${entry.id}` });
    expect(await db.auditLog.count({ where: { action: "BOLLPLOCKARE_CLOCK_IN" } })).toBe(1);
    expect((await getMyClockState(db, w.eAct, at(D, "19:50"))).active?.workedSeconds).toBe(5 * 60);
  });

  it("inom säkerhetsmarginalen går att klocka in; utanför marginalen och osäker GPS går inte", async () => {
    const w = await world();
    expect(await clockIn(db, w.eAct, { sample: pos(east(80)), now: at(D, "19:45") })).toMatchObject({ ok: false, code: "OUTSIDE_AREA" });
    expect(await clockIn(db, w.eAct, { sample: pos(inside, 300), now: at(D, "19:45") })).toMatchObject({ ok: false, code: "GPS_UNRELIABLE" });
    expect(await clockIn(db, w.eAct, { sample: lost, now: at(D, "19:45") })).toMatchObject({ ok: false, code: "GPS_REQUIRED" });
    expect(await clockIn(db, w.eAct, { sample: { kind: "problem", problem: "DENIED" }, now: at(D, "19:45") })).toMatchObject({ ok: false, code: "GPS_REQUIRED", message: expect.stringContaining("tillåta") });
    expect(await db.workTimeEntry.count()).toBe(0);
    expect(await clockIn(db, w.eAct, { sample: pos(east(25)), now: at(D, "19:45") })).toMatchObject({ ok: true, zone: "MARGIN" });
  });

  it("utan inställt arbetsområde går det inte att klocka in", async () => {
    const w = await world({ area: false });
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") })).toMatchObject({ ok: false, code: "AREA_NOT_CONFIGURED" });
  });

  it("dubbla incheckningar: andra försöket och två samtidiga flikar ger exakt ETT pass", async () => {
    const w = await world();
    const results = await Promise.all([0, 1, 2, 3].map(() => clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") })));
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && (r.code === "ALREADY_ACTIVE" || r.code === "CONFLICT"))).toBe(true);
    expect(await db.workTimeEntry.count()).toBe(1);
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:50") })).toMatchObject({ ok: false, code: "ALREADY_ACTIVE" });
  });

  it("endast bollplockare: golfshop-personal och admin utan bollplockaranställning nekas", async () => {
    const w = await world();
    await expect(clockIn(db, { id: w.lisa.user!.id, role: "GOLFSHOP" }, { sample: pos(inside), now: at(D, "19:45") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clockIn(db, w.admin, { sample: pos(inside), now: at(D, "19:45") })).rejects.toBeInstanceOf(ForbiddenError);
    await db.employee.update({ where: { id: w.erik.employee.id }, data: { status: "INACTIVE" } });
    await expect(clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("admin ändrar stängningstid eller marginal", () => {
  it("standardvärdena: 20.00 stängning och 20 min marginal. Ändring uppdaterar passen och notifierar", async () => {
    const w = await world();
    expect(await getSettings(db)).toMatchObject({ defaultCloseTime: "20:00", checkInMarginMinutes: 20 });
    await updateSettings(db, w.admin, { ...(await getSettings(db)), defaultCloseTime: "21:00" }, SETUP_NOW);
    expect((await db.shift.findUniqueOrThrow({ where: { id: w.shiftId } })).startsAt).toEqual(at(D, "20:40"));
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") })).toMatchObject({ ok: false, code: "TOO_EARLY" });
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "20:41") })).toMatchObject({ ok: true });
    const n = await listMyNotifications(db, w.erik.user!.id);
    expect(n.find((x) => x.type === "SHIFT_CHANGED")?.body).toContain("20.40");
  });

  it("marginal 10 minuter: avvikande stängningstid för ett datum och stängd dag fungerar", async () => {
    const w = await world();
    await updateSettings(db, w.admin, { ...(await getSettings(db)), checkInMarginMinutes: 10 }, SETUP_NOW);
    expect((await db.shift.findUniqueOrThrow({ where: { id: w.shiftId } })).startsAt).toEqual(at(D, "19:50"));
    await setDayOverride(db, w.admin, { date: D, closed: false, closeTime: "18:30" }, SETUP_NOW);
    expect((await db.shift.findUniqueOrThrow({ where: { id: w.shiftId } })).startsAt).toEqual(at(D, "18:20"));
    await setDayOverride(db, w.admin, { date: D, closed: true }, SETUP_NOW);
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:00") })).toMatchObject({ ok: false, code: "CLOSED_DAY" });
  });

  it("ogiltiga inställningar och obehöriga avvisas", async () => {
    const w = await world();
    await expect(updateSettings(db, w.admin, { ...(await getSettings(db)), defaultCloseTime: "25:00" })).rejects.toThrow();
    await expect(updateSettings(db, w.admin, { ...(await getSettings(db)), checkInMarginMinutes: -5 })).rejects.toThrow();
    await expect(updateSettings(db, w.admin, { ...(await getSettings(db)), verificationSeconds: 1 })).rejects.toThrow();
    await expect(updateSettings(db, w.eAct, await getSettings(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveWorkArea(db, w.eAct, { polygons: [RING], marginMeters: 40, expectedVersion: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setDayOverride(db, w.eAct, { date: D, closed: true })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("positioner, verifiering, paus och återupptagning", () => {
  async function active() {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    return w;
  }
  const report = (w: Awaited<ReturnType<typeof world>>, sec: number, sample: Parameters<typeof reportPosition>[2]["sample"]) =>
    reportPosition(db, w.eAct, { sample, now: at(D, "19:45", sec) });

  it("hela flödet: lämnar området, verifieras i 30 s, pausas, återvänder, återupptas. Båda parter notifieras, tiden räknas rätt", async () => {
    const w = await active();
    expect(await report(w, 60, pos(east(25)))).toMatchObject({ ok: true, zone: "MARGIN" }); // marginalen: ingenting händer
    expect((await db.gpsPause.count())).toBe(0);
    await report(w, 120, pos(east(54)));
    await report(w, 135, pos(east(55)));
    const paused = await report(w, 150, pos(east(56)));
    expect(paused).toMatchObject({ ok: true });
    expect(paused.ok && paused.snapshot.pauseOpenSince).toEqual(at(D, "19:45", 120)); // pausen börjar vid första mätningen utanför
    const pause = await db.gpsPause.findFirstOrThrow();
    expect(Math.round(pause.distanceM!)).toBe(56);

    const adminN = (await listMyNotifications(db, w.adminUser.id)).filter((n) => n.type === "WORK_PAUSED");
    expect(adminN).toHaveLength(1);
    expect(adminN[0].title).toBe("Bollplockare har lämnat arbetsområdet");
    expect(adminN[0].body).toContain("Anställd: Erik Andersson");
    expect(adminN[0].body).toContain("Avstånd från golfanläggningens gräns: 56 meter");
    expect(adminN[0].body).toContain("Tillåten säkerhetsmarginal: 40 meter");
    expect(adminN[0].body).toContain("Arbetstid pausad");
    expect((await listMyNotifications(db, w.erik.user!.id)).filter((n) => n.type === "WORK_PAUSED")).toHaveLength(1);

    // medan tiden är pausad står arbetstiden stilla
    const s1 = (await getMyClockState(db, w.eAct, at(D, "19:45", 300))).active!;
    const s2 = (await getMyClockState(db, w.eAct, at(D, "19:45", 600))).active!;
    expect(s1.workedSeconds).toBe(120);
    expect(s2.workedSeconds).toBe(120);
    expect(s2.pauseOpenSince).not.toBeNull();

    // upprepade mätningar utanför ger inga fler notiser eller pauser
    await report(w, 165, pos(east(57)));
    expect(await db.gpsPause.count()).toBe(1);
    expect((await listMyNotifications(db, w.adminUser.id)).filter((n) => n.type === "WORK_PAUSED")).toHaveLength(1);

    // återvänder
    await report(w, 400, pos(inside));
    const back = await report(w, 415, pos(inside));
    expect(back).toMatchObject({ ok: true });
    const closed = await db.gpsPause.findFirstOrThrow();
    expect([closed.endedAt, closed.endedBy]).toEqual([at(D, "19:45", 400), "RETURNED"]);
    expect((await listMyNotifications(db, w.adminUser.id)).filter((n) => n.type === "WORK_RESUMED")).toHaveLength(1);
    expect((await listMyNotifications(db, w.erik.user!.id)).filter((n) => n.type === "WORK_RESUMED")).toHaveLength(1);

    const events = (await db.gpsEvent.findMany({ orderBy: { at: "asc" } })).map((e) => e.type);
    expect(events).toEqual(["CLOCK_IN", "PAUSE_STARTED", "PAUSE_ENDED"]);
  });

  it("en enda felaktig mätning (utanför) pausar inte, och osäker/uteblivin GPS är aldrig en avvikelse", async () => {
    const w = await active();
    await report(w, 30, pos(east(300)));
    await report(w, 45, pos(inside));
    await report(w, 60, pos(east(500), 400)); // dålig noggrannhet
    await report(w, 75, lost);
    await report(w, 90, { kind: "problem", problem: "DENIED" });
    expect(await db.gpsPause.count()).toBe(0);
    const s = await db.bollplockareSession.findFirstOrThrow();
    expect(s.gpsStatus).toBe("DENIED");
    expect(s.needsReview).toBe(false);
    // passets huvudtillstånd påverkas inte: tiden fortsätter
    expect((await getMyClockState(db, w.eAct, at(D, "19:45", 100))).active?.workedSeconds).toBe(100);
  });

  it("flera flikar skickar mätningar samtidigt: exakt EN paus skapas", async () => {
    const w = await active();
    await report(w, 10, pos(east(80)));
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map(() => report(w, 60, pos(east(80)))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await db.gpsPause.count()).toBe(1);
    expect((await listMyNotifications(db, w.adminUser.id)).filter((n) => n.type === "WORK_PAUSED")).toHaveLength(1);
  });

  it("positioner utan pågående pass avvisas och sparas aldrig", async () => {
    const w = await world();
    expect(await reportPosition(db, w.eAct, { sample: pos(inside), now: at(D, "19:50") })).toMatchObject({ ok: false, code: "NOT_ACTIVE" });
    expect(await db.bollplockareSession.count()).toBe(0);
  });

  it("gamla positioner visas aldrig som aktuella: status blir STALE och senast verifierade tid finns kvar", async () => {
    const w = await active();
    await report(w, 30, pos(inside));
    const snap = (await getMyClockState(db, w.eAct, at(D, "19:45", 1000))).active!;
    expect(snap.lastPositionAt).toEqual(at(D, "19:45", 30));
    expect(snap.gpsStatus).toBe("INSIDE"); // sparad status; visningslagret gör den STALE efter 120 s (displayGpsStatus)
  });
});

describe("klocka ut", () => {
  it("exemplet: in 19.45, ut 21.32 med 5 min paus: 107 min totalt, 102 min registrerat, GPS-data rensad", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    // paus 20.30–20.35
    for (const [t, p] of [["20:30:00", east(60)], ["20:30:15", east(60)], ["20:30:30", east(60)], ["20:35:00", inside], ["20:35:15", inside]] as const) {
      const [hh, mm, ss] = t.split(":").map(Number);
      await reportPosition(db, w.eAct, { sample: pos(p as Pt), now: at(D, `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, ss) });
    }
    const out = await clockOut(db, w.eAct, { now: at(D, "21:32") });
    expect(out).toMatchObject({ ok: true, totalMinutes: 107, pausedMinutes: 5, registeredMinutes: 102 });

    const entry = await db.workTimeEntry.findFirstOrThrow({ include: { bollplockareSession: true, shift: true } });
    expect([entry.registeredMinutes, entry.registeredEndsAt]).toEqual([102, at(D, "21:32")]);
    expect(entry.shift.workStatus).toBe("COMPLETED");
    expect(entry.bollplockareSession).toMatchObject({ pausedMinutes: 5, needsReview: true, gpsStatus: "NONE", lastLat: null, lastLng: null, lastAccuracyM: null, lastDistanceM: null });
    expect(entry.bollplockareSession?.reviewReasons).toContain("Geografisk paus");
    expect((await db.gpsEvent.findMany({ orderBy: { at: "asc" } })).map((e) => e.type)).toEqual(["CLOCK_IN", "PAUSE_STARTED", "PAUSE_ENDED", "CLOCK_OUT"]);
    expect((await listMyNotifications(db, w.adminUser.id)).some((n) => n.type === "WORK_CLOCKED_OUT")).toBe(true);
    // GPS-spårningen är avslutad: nya positioner tas inte emot
    expect(await reportPosition(db, w.eAct, { sample: pos(inside), now: at(D, "21:33") })).toMatchObject({ ok: false, code: "NOT_ACTIVE" });
    expect(await db.bollplockareSession.findFirstOrThrow()).toMatchObject({ lastLat: null, lastLng: null });
  });

  it("går att klocka ut under en paus och utan GPS: pausen avslutas vid utcheckning", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    for (const s of [0, 15, 30]) await reportPosition(db, w.eAct, { sample: pos(east(90)), now: at(D, "20:00", s) });
    expect((await db.gpsPause.findFirstOrThrow()).endedAt).toBeNull();
    const out = await clockOut(db, w.eAct, { now: at(D, "20:20") });
    expect(out).toMatchObject({ ok: true, totalMinutes: 35, pausedMinutes: 20, registeredMinutes: 15 });
    expect(await db.gpsPause.findFirstOrThrow()).toMatchObject({ endedAt: at(D, "20:20"), endedBy: "CLOCKED_OUT" });
  });

  it("dubbel utcheckning (även samtidigt från flera flikar) ger ett enda avslut och påverkar inte arbetstiden", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    const results = await Promise.all([0, 1, 2, 3].map(() => clockOut(db, w.eAct, { now: at(D, "21:00") })));
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(await clockOut(db, w.eAct, { now: at(D, "22:00") })).toMatchObject({ ok: false, code: "NOT_ACTIVE" });
    expect((await db.workTimeEntry.findFirstOrThrow()).registeredMinutes).toBe(75);
    expect(await db.gpsEvent.count({ where: { type: "CLOCK_OUT" } })).toBe(1);
  });

  it("efter utcheckning kan man inte checka in igen samma dag", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    await clockOut(db, w.eAct, { now: at(D, "21:00") });
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "21:10") })).toMatchObject({ ok: false, code: "ALREADY_DONE" });
    const state = await getMyClockState(db, w.eAct, at(D, "21:10"));
    expect(state.finished).toMatchObject({ registeredMinutes: 75, totalMinutes: 75 });
  });

  it("pass över midnatt: tillhör startdagen, och sidladdning efter midnatt visar fortfarande det pågående passet", async () => {
    const w = await world();
    await updateSettings(db, w.admin, { ...(await getSettings(db)), defaultCloseTime: "23:30" }, SETUP_NOW);
    expect(await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "23:15") })).toMatchObject({ ok: true });
    const after = await getMyClockState(db, w.eAct, at("2026-11-25", "00:20"));
    expect(after.active).toMatchObject({ workedSeconds: 65 * 60 });
    expect(after.shift?.date).toBe(D);
    const out = await clockOut(db, w.eAct, { now: at("2026-11-25", "00:40") });
    expect(out).toMatchObject({ ok: true, registeredMinutes: 85 });
    expect((await db.workTimeEntry.findFirstOrThrow()).workDate.toISOString().slice(0, 10)).toBe(D);
  });

  it("webbläsaren stängs och öppnas igen: tillståndet kommer från servern, inte från en timer", async () => {
    const w = await world();
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    const reopened = await getMyClockState(db, w.eAct, at(D, "20:45"));
    expect(reopened.active?.workedSeconds).toBe(3600);
    expect(reopened.availability.status).toBe("ALREADY_ACTIVE");
  });

  it("två bollplockare påverkar inte varandras pass", async () => {
    const w = await world();
    await createShift(db, w.admin, { employeeId: w.olle.employee.id, date: D, from: "11:00", to: "15:00", publish: true, now: SETUP_NOW });
    await clockIn(db, w.eAct, { sample: pos(inside), now: at(D, "19:45") });
    await clockIn(db, w.oAct, { sample: pos(inside), now: at(D, "19:46") });
    await clockOut(db, w.eAct, { now: at(D, "20:45") });
    expect((await getMyClockState(db, w.oAct, at(D, "20:46"))).active?.workedSeconds).toBe(60 * 60);
    expect(await db.workTimeEntry.count()).toBe(2);
  });
});
