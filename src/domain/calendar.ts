import { DateTime } from "luxon";
import { STOCKHOLM_TZ, stockholmDateOf, stockholmYearMonth } from "./time";

export type YearMonth = { year: number; month: number };

/** "2026-11" -> { year, month }. Ogiltigt eller saknat värde ger innevarande månad (Stockholm). */
export function parseMonthParam(value: string | null | undefined, now: Date): YearMonth {
  const match = value ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value) : null;
  if (match) {
    const year = Number(match[1]);
    if (year >= 2000 && year <= 2100) return { year, month: Number(match[2]) };
  }
  return stockholmYearMonth(now);
}

export function monthParam({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const dt = DateTime.fromObject({ year, month, day: 1 }, { zone: STOCKHOLM_TZ }).plus({ months: delta });
  return { year: dt.year, month: dt.month };
}

export type CalendarDay = { date: string; day: number; inMonth: boolean; isToday: boolean; isWeekend: boolean };

/** Månadskalender, måndag först, med hela veckor (dagar från grannmånaderna markeras inMonth=false). */
export function buildMonthGrid({ year, month }: YearMonth, now: Date): CalendarDay[][] {
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: STOCKHOLM_TZ });
  const today = stockholmDateOf(now);
  const start = first.minus({ days: first.weekday - 1 }); // weekday: 1 = måndag
  const last = first.endOf("month");
  const weeks: CalendarDay[][] = [];
  let cursor = start;
  while (cursor <= last || weeks.length === 0 || cursor.weekday !== 1) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = cursor.toISODate() as string;
      week.push({ date, day: cursor.day, inMonth: cursor.month === month, isToday: date === today, isWeekend: cursor.weekday >= 6 });
      cursor = cursor.plus({ days: 1 });
    }
    weeks.push(week);
    if (cursor > last && cursor.weekday === 1) break;
  }
  return weeks;
}

export const WEEKDAYS_SHORT = ["Mån", "Tis", "Ons", "Tors", "Fre", "Lör", "Sön"] as const;
