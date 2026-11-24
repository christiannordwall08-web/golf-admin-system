import { addDaysToDateString } from "@/domain/time";

/** Veckodagar: 1 = måndag … 7 = söndag (ISO). */
export const WEEKDAY_LABELS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"] as const;

function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = söndag
  return d === 0 ? 7 : d;
}

export const MAX_BULK_DATES = 100;

/** Alla datum mellan två datum (inklusive) som infaller på någon av veckodagarna. Kastar vid orimligt stora intervall. */
export function datesForWeekdays(from: string, to: string, weekdays: readonly number[]): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new RangeError("Ogiltigt datum.");
  if (to < from) throw new RangeError("Slutdatum före startdatum.");
  const wanted = new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7));
  const out: string[] = [];
  let d = from;
  for (let i = 0; i < 400 && d <= to; i++) {
    if (wanted.has(isoWeekday(d))) out.push(d);
    d = addDaysToDateString(d, 1);
  }
  if (d <= to) throw new RangeError("Intervallet är för långt (högst ca ett år).");
  if (out.length > MAX_BULK_DATES) throw new RangeError(`Högst ${MAX_BULK_DATES} datum åt gången.`);
  return out;
}
