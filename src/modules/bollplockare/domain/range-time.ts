import { MAX_SHIFT_MINUTES } from "@/domain/shifts";
import { addDaysToDateString, localToInstant } from "@/domain/time";

/**
 * Rangens dag: stängningstid, tidigaste incheckning och arbetsdygnets slut.
 * Alla tider beräknas i Stockholm-tid (sommar-/vintertid hanteras av localToInstant) och aldrig av klientens klocka.
 */
export type RangeSettingsLike = { defaultCloseTime: string; checkInMarginMinutes: number };
export type DayOverrideLike = { closeTime: string | null; isClosed: boolean } | null | undefined;

/** Arbetsdygnet för en schemadag slutar 06.00 nästa morgon. Ett pass som passerar midnatt hör till startdagen. */
export const WORK_DAY_END = "06:00";

export type RangeDay = {
  date: string;
  closed: boolean;
  /** "HH:mm" eller null om stängd dag. */
  closeTime: string | null;
  closeAt: Date | null;
  /** Tidigaste tillåtna incheckning = stängning − marginalen. */
  earliestCheckIn: Date | null;
  /** Slutet på arbetsdygnet. Efter detta kan man inte längre klocka in för dagen (utcheckning går alltid). */
  windowEnd: Date;
  isOverride: boolean;
};

export function rangeDay(date: string, settings: RangeSettingsLike, override?: DayOverrideLike): RangeDay {
  const dayEnd = localToInstant(addDaysToDateString(date, 1), WORK_DAY_END);
  if (override?.isClosed) {
    return { date, closed: true, closeTime: null, closeAt: null, earliestCheckIn: null, windowEnd: dayEnd, isOverride: true };
  }
  const closeTime = override?.closeTime ?? settings.defaultCloseTime;
  const closeAt = localToInstant(date, closeTime);
  const earliestCheckIn = new Date(closeAt.getTime() - settings.checkInMarginMinutes * 60_000);
  // Fönstret får aldrig bli längre än längsta tillåtna pass (databasen och schemakontrollerna kräver det).
  const windowEnd = new Date(Math.min(dayEnd.getTime(), earliestCheckIn.getTime() + MAX_SHIFT_MINUTES * 60_000));
  return { date, closed: false, closeTime, closeAt, earliestCheckIn, windowEnd, isOverride: Boolean(override?.closeTime) };
}

/** Intervallet som sparas på ett pass utan fast sluttid (Shift.openEnded). Null för stängd dag. */
export function openEndedWindow(day: RangeDay): { startsAt: Date; endsAt: Date } | null {
  return day.earliestCheckIn ? { startsAt: day.earliestCheckIn, endsAt: day.windowEnd } : null;
}

export type ClockInAvailability =
  | { status: "AVAILABLE" }
  | { status: "TOO_EARLY"; secondsUntil: number; opensAt: Date }
  | { status: "CLOSED_DAY" | "WINDOW_ENDED" | "CANCELLED" | "NOT_PUBLISHED" | "ALREADY_ACTIVE" | "ALREADY_DONE" | "NO_SHIFT" };

/** Får personen klocka in just nu? Samma funktion används av servern (som avgör) och av gränssnittet (som visar varför). */
export function clockInAvailability(input: {
  now: Date;
  day: RangeDay | null;
  shift: { cancelled: boolean; published: boolean } | null;
  hasActiveEntry: boolean;
  hasFinishedEntry: boolean;
}): ClockInAvailability {
  if (input.hasActiveEntry) return { status: "ALREADY_ACTIVE" };
  if (input.hasFinishedEntry) return { status: "ALREADY_DONE" };
  if (!input.shift || !input.day) return { status: "NO_SHIFT" };
  if (input.shift.cancelled) return { status: "CANCELLED" };
  if (!input.shift.published) return { status: "NOT_PUBLISHED" };
  if (input.day.closed || !input.day.earliestCheckIn) return { status: "CLOSED_DAY" };
  if (input.now >= input.day.windowEnd) return { status: "WINDOW_ENDED" };
  if (input.now < input.day.earliestCheckIn) {
    return {
      status: "TOO_EARLY",
      secondsUntil: Math.ceil((input.day.earliestCheckIn.getTime() - input.now.getTime()) / 1000),
      opensAt: input.day.earliestCheckIn,
    };
  }
  return { status: "AVAILABLE" };
}

export const CLOCK_IN_MESSAGE: Record<Exclude<ClockInAvailability["status"], "AVAILABLE" | "TOO_EARLY">, string> = {
  CLOSED_DAY: "Rangen är stängd den här dagen.",
  WINDOW_ENDED: "Arbetsdagen är över. Kontakta admin om du har arbetat.",
  CANCELLED: "Passet är inställt.",
  NOT_PUBLISHED: "Passet är inte publicerat än.",
  ALREADY_ACTIVE: "Du är redan incheckad.",
  ALREADY_DONE: "Du har redan arbetat klart den här dagen.",
  NO_SHIFT: "Du har inget arbetspass att klocka in på just nu.",
};
