import { describe, expect, it } from "vitest";
import { localToInstant } from "@/domain/time";
import { clockInAvailability, openEndedWindow, rangeDay } from "@/modules/bollplockare/domain/range-time";
import { deriveWorkState, liveWorkedSeconds, pausedSecondsBetween, sessionTotals } from "@/modules/bollplockare/domain/worktime";

const SETTINGS = { defaultCloseTime: "20:00", checkInMarginMinutes: 20 };
const lt = (date: string, time: string) => localToInstant(date, time);

describe("rangens dag", () => {
  it("tidigaste incheckning är stängningstid − marginal (exemplet i kravet: 20.00 − 20 min = 19.40)", () => {
    const d = rangeDay("2026-11-24", SETTINGS);
    expect(d.closeTime).toBe("20:00");
    expect(d.earliestCheckIn).toEqual(lt("2026-11-24", "19:40"));
    expect(d.closed).toBe(false);
  });

  it("marginalen är konfigurerbar (10 och 15 minuter)", () => {
    expect(rangeDay("2026-11-24", { ...SETTINGS, checkInMarginMinutes: 10 }).earliestCheckIn).toEqual(lt("2026-11-24", "19:50"));
    expect(rangeDay("2026-11-24", { ...SETTINGS, checkInMarginMinutes: 15 }).earliestCheckIn).toEqual(lt("2026-11-24", "19:45"));
  });

  it("avvikande stängningstid för ett datum ändrar tidigaste incheckning; stängd dag har ingen", () => {
    const early = rangeDay("2026-11-24", SETTINGS, { closeTime: "18:30", isClosed: false });
    expect([early.closeTime, early.isOverride, early.earliestCheckIn]).toEqual(["18:30", true, lt("2026-11-24", "18:10")]);
    const closed = rangeDay("2026-11-24", SETTINGS, { closeTime: null, isClosed: true });
    expect([closed.closed, closed.earliestCheckIn, openEndedWindow(closed)]).toEqual([true, null, null]);
  });

  it("arbetsdygnet slutar 06.00 nästa morgon: ett pass över midnatt hör till startdagen", () => {
    const d = rangeDay("2026-11-24", SETTINGS);
    expect(d.windowEnd).toEqual(lt("2026-11-25", "06:00"));
    expect(openEndedWindow(d)).toEqual({ startsAt: lt("2026-11-24", "19:40"), endsAt: lt("2026-11-25", "06:00") });
  });

  it("sommartid: tiderna följer Stockholm-klockan även över omställningen", () => {
    // Sommartid börjar söndag 29 mars 2026, vintertid söndag 25 oktober 2026.
    expect(rangeDay("2026-03-28", SETTINGS).windowEnd).toEqual(lt("2026-03-29", "06:00"));
    expect(rangeDay("2026-10-24", SETTINGS).windowEnd).toEqual(lt("2026-10-25", "06:00"));
    const night = rangeDay("2026-10-24", SETTINGS);
    // 19.40 → 06.00 är 10 h 20 min på klockan men 11 h 20 min i verklig tid (extra timme vid övergång till vintertid)
    expect((night.windowEnd.getTime() - night.earliestCheckIn!.getTime()) / 60_000).toBe(11 * 60 + 20);
  });
});

describe("får man klocka in?", () => {
  const day = rangeDay("2026-11-24", SETTINGS);
  const shift = { cancelled: false, published: true };
  const base = { day, shift, hasActiveEntry: false, hasFinishedEntry: false };

  it("för tidigt: visar nedräkning till tidigaste incheckning (23 minuter)", () => {
    const r = clockInAvailability({ ...base, now: lt("2026-11-24", "19:17") });
    expect(r).toMatchObject({ status: "TOO_EARLY", secondsUntil: 23 * 60 });
  });

  it("öppnar exakt vid tidigaste incheckning och är öppen fram till arbetsdygnets slut", () => {
    expect(clockInAvailability({ ...base, now: lt("2026-11-24", "19:39") }).status).toBe("TOO_EARLY");
    expect(clockInAvailability({ ...base, now: lt("2026-11-24", "19:40") }).status).toBe("AVAILABLE");
    expect(clockInAvailability({ ...base, now: lt("2026-11-24", "21:32") }).status).toBe("AVAILABLE");
    expect(clockInAvailability({ ...base, now: lt("2026-11-25", "05:59") }).status).toBe("AVAILABLE");
    expect(clockInAvailability({ ...base, now: lt("2026-11-25", "06:00") }).status).toBe("WINDOW_ENDED");
  });

  it("om admin ändrar stängningstiden uppdateras tidigaste incheckning direkt", () => {
    const later = rangeDay("2026-11-24", SETTINGS, { closeTime: "21:00", isClosed: false });
    const now = lt("2026-11-24", "19:45");
    expect(clockInAvailability({ ...base, now }).status).toBe("AVAILABLE");
    expect(clockInAvailability({ ...base, day: later, now }).status).toBe("TOO_EARLY");
  });

  it("nekas utan pass, för inställt/opublicerat pass, stängd dag, pågående eller klart pass", () => {
    const now = lt("2026-11-24", "20:00");
    expect(clockInAvailability({ ...base, now, shift: null }).status).toBe("NO_SHIFT");
    expect(clockInAvailability({ ...base, now, shift: { cancelled: true, published: true } }).status).toBe("CANCELLED");
    expect(clockInAvailability({ ...base, now, shift: { cancelled: false, published: false } }).status).toBe("NOT_PUBLISHED");
    expect(clockInAvailability({ ...base, now, day: rangeDay("2026-11-24", SETTINGS, { closeTime: null, isClosed: true }) }).status).toBe("CLOSED_DAY");
    expect(clockInAvailability({ ...base, now, hasActiveEntry: true }).status).toBe("ALREADY_ACTIVE");
    expect(clockInAvailability({ ...base, now, hasFinishedEntry: true }).status).toBe("ALREADY_DONE");
  });
});

describe("arbetstid och pauser", () => {
  const t = (date: string, time: string) => lt(date, time);

  it("exemplet i kravet: 19.45–21.32 med 5 min paus = 1 h 47 min totalt, 1 h 42 min registrerat", () => {
    const r = sessionTotals({
      startedAt: t("2026-11-24", "19:45"),
      endedAt: t("2026-11-24", "21:32"),
      pauses: [{ startedAt: t("2026-11-24", "20:30"), endedAt: t("2026-11-24", "20:35") }],
    });
    expect([r.totalMinutes, r.pausedMinutes, r.registeredMinutes]).toEqual([107, 5, 102]);
  });

  it("pass över midnatt räknas rätt (instant-aritmetik)", () => {
    const r = sessionTotals({ startedAt: t("2026-11-24", "23:15"), endedAt: t("2026-11-25", "00:50"), pauses: [] });
    expect(r.registeredMinutes).toBe(95);
  });

  it("vid vintertidsbytet (natten mot 25 oktober) är en timme extra verklig tid", () => {
    const r = sessionTotals({ startedAt: t("2026-10-24", "23:00"), endedAt: t("2026-10-25", "04:00"), pauses: [] });
    expect(r.registeredMinutes).toBe(6 * 60); // 5 klocktimmar + den extra timmen
  });

  it("vid sommartidsbytet (natten mot 29 mars) saknas en timme", () => {
    const r = sessionTotals({ startedAt: t("2026-03-28", "23:00"), endedAt: t("2026-03-29", "04:00"), pauses: [] });
    expect(r.registeredMinutes).toBe(4 * 60);
  });

  it("överlappande och ogiltigförklarade pauser dubbelräknas inte; pauser klipps till passet; aldrig negativ tid", () => {
    const start = t("2026-11-24", "19:45");
    const end = t("2026-11-24", "21:00");
    const pauses = [
      { startedAt: t("2026-11-24", "20:00"), endedAt: t("2026-11-24", "20:20") },
      { startedAt: t("2026-11-24", "20:10"), endedAt: t("2026-11-24", "20:30") }, // överlappar: totalt 20:00–20:30
      { startedAt: t("2026-11-24", "20:40"), endedAt: t("2026-11-24", "20:50"), voided: true }, // rättad: räknas inte
      { startedAt: t("2026-11-24", "20:55"), endedAt: null }, // öppen paus löper till utcheckning
    ];
    const r = sessionTotals({ startedAt: start, endedAt: end, pauses });
    expect(r.pausedMinutes).toBe(35);
    expect(r.registeredMinutes).toBe(75 - 35);
    const swapped = sessionTotals({ startedAt: end, endedAt: start, pauses: [] });
    expect([swapped.totalSeconds, swapped.registeredMinutes]).toEqual([0, 0]);
    expect(pausedSecondsBetween([{ startedAt: t("2026-11-24", "10:00"), endedAt: t("2026-11-24", "23:00") }], start, end)).toBe(75 * 60);
  });

  it("timern: pågående arbetstid utan paustid, från serverns tidsstämplar", () => {
    const started = t("2026-11-24", "19:45");
    const pauses = [{ startedAt: t("2026-11-24", "20:00"), endedAt: t("2026-11-24", "20:10") }];
    expect(liveWorkedSeconds(started, pauses, t("2026-11-24", "20:30"))).toBe((45 - 10) * 60);
    // pågående paus: tiden står stilla
    const open = [{ startedAt: t("2026-11-24", "20:00"), endedAt: null }];
    expect(liveWorkedSeconds(started, open, t("2026-11-24", "20:30"))).toBe(15 * 60);
    expect(liveWorkedSeconds(started, open, t("2026-11-24", "21:30"))).toBe(15 * 60);
  });
});

describe("passets huvudtillstånd", () => {
  const now = lt("2026-11-24", "20:00");
  const earliest = lt("2026-11-24", "19:40");
  const entry = (over: Partial<NonNullable<Parameters<typeof deriveWorkState>[0]["entry"]>> = {}) => ({ endedAt: null, openPause: false, status: "PRELIMINARY" as const, needsReview: false, ...over });

  it("härleds ur fakta, och GPS-status ingår aldrig", () => {
    expect(deriveWorkState({ now: lt("2026-11-24", "10:00"), cancelled: false, earliestCheckIn: earliest, entry: null })).toBe("SCHEDULED");
    expect(deriveWorkState({ now, cancelled: false, earliestCheckIn: earliest, entry: null })).toBe("AWAITING_CHECK_IN");
    expect(deriveWorkState({ now, cancelled: false, earliestCheckIn: earliest, entry: entry() })).toBe("ACTIVE");
    expect(deriveWorkState({ now, cancelled: false, earliestCheckIn: earliest, entry: entry({ openPause: true }) })).toBe("PAUSED");
    expect(deriveWorkState({ now, cancelled: false, earliestCheckIn: earliest, entry: entry({ endedAt: now }) })).toBe("COMPLETED");
    expect(deriveWorkState({ now, cancelled: false, earliestCheckIn: earliest, entry: entry({ endedAt: now, needsReview: true }) })).toBe("NEEDS_REVIEW");
    expect(deriveWorkState({ now, cancelled: false, earliestCheckIn: earliest, entry: entry({ endedAt: now, status: "APPROVED" }) })).toBe("APPROVED");
    expect(deriveWorkState({ now, cancelled: true, earliestCheckIn: earliest, entry: null })).toBe("CANCELLED");
  });
});
