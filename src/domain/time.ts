import { DateTime } from "luxon";

/**
 * All presentation och all gruppering per dag/månad sker i Europe/Stockholm.
 * Tidpunkter lagras som UTC-instants (timestamptz). Kalenderdatum lagras som @db.Date
 * och betyder Stockholm-datum. Varaktighet räknas alltid på verkligt förfluten tid, så
 * ett nattpass över sommar-/vintertidsbytet blir 1 timme kortare/längre än klockan antyder.
 */
export const STOCKHOLM_TZ = "Europe/Stockholm";

export class InvalidLocalTimeError extends Error {
  constructor(date: string, time: string) {
    super(`${date} ${time} finns inte i Stockholm (sommartidsbyte)`);
    this.name = "InvalidLocalTimeError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Stockholm-datum "YYYY-MM-DD" för en tidpunkt. */
export function stockholmDateOf(instant: Date): string {
  const dt = DateTime.fromJSDate(instant, { zone: STOCKHOLM_TZ });
  return dt.toISODate() as string;
}

/**
 * Stockholm-datum + klockslag -> tidpunkt (UTC).
 * - Klockslag som inte existar (hoppet vid sommartid) avvisas.
 * - Dubbeltydiga klockslag (vintertidsbytet) tolkas som den första förekomsten.
 */
export function localToInstant(date: string, time: string): Date {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) {
    throw new RangeError(`Ogiltigt datum/tid: "${date}" "${time}"`);
  }
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: STOCKHOLM_TZ });
  if (!dt.isValid || dt.toFormat("HH:mm") !== time || dt.toISODate() !== date) {
    throw new InvalidLocalTimeError(date, time);
  }
  // Vintertidsbytet: samma klockslag inträffar två gånger. Välj uttryckligen den första
  // (Luxons standardval är den senare). En timme tidigare med samma klockslag = dubbeltydigt.
  const earlier = dt.minus({ hours: 1 });
  if (earlier.toFormat("HH:mm") === time && earlier.toISODate() === date) {
    return earlier.toJSDate();
  }
  return dt.toJSDate();
}

/** Hela minuter mellan två tidpunkter (verklig förfluten tid). */
export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

/** True om tidpunkten ligger på hel minut (inga sekunder/millisekunder). */
export function isWholeMinute(instant: Date): boolean {
  return instant.getTime() % 60_000 === 0;
}

/** [start, slut) för en kalendermånad i Stockholm, som UTC-tidpunkter. */
export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Ogiltig månad: ${year}-${month}`);
  }
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone: STOCKHOLM_TZ });
  return { start: start.toJSDate(), end: start.plus({ months: 1 }).toJSDate() };
}

/** { year, month } (Stockholm) för en tidpunkt. */
export function stockholmYearMonth(instant: Date): { year: number; month: number } {
  const dt = DateTime.fromJSDate(instant, { zone: STOCKHOLM_TZ });
  return { year: dt.year, month: dt.month };
}

/** "YYYY-MM-DD" plus (eller minus) ett antal dagar. */
export function addDaysToDateString(date: string, days: number): string {
  if (!DATE_RE.test(date)) throw new RangeError(`Ogiltigt datum: "${date}"`);
  const dt = DateTime.fromISO(date, { zone: STOCKHOLM_TZ });
  if (!dt.isValid) throw new RangeError(`Ogiltigt datum: "${date}"`);
  return dt.plus({ days }).toISODate() as string;
}

/** Klockslag "HH:mm" (Stockholm-tid) för en tidpunkt. */
export function localTimeOf(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: STOCKHOLM_TZ }).toFormat("HH:mm");
}

/** [start, slut) för ett Stockholm-dygn "YYYY-MM-DD" som UTC-tidpunkter (23 eller 25 timmar vid tidsbyte). */
export function dayBounds(date: string): { start: Date; end: Date } {
  if (!DATE_RE.test(date)) throw new RangeError(`Ogiltigt datum: "${date}"`);
  const start = DateTime.fromISO(date, { zone: STOCKHOLM_TZ });
  if (!start.isValid) throw new RangeError(`Ogiltigt datum: "${date}"`);
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}

/** "YYYY-MM-DD" -> Date för @db.Date-kolumner (UTC-midnatt). */
export function dateStringToDbDate(date: string): Date {
  if (!DATE_RE.test(date)) throw new RangeError(`Ogiltigt datum: "${date}"`);
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Ogiltigt datum: "${date}"`);
  }
  return d;
}

/** @db.Date-värde -> "YYYY-MM-DD". */
export function dbDateToString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Jämför två "YYYY-MM-DD"-strängar: -1, 0 eller 1. */
export function compareDateStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "09.00–13.00" (svenskt format, i Stockholm-tid). */
export function formatTimeRange(start: Date, end: Date): string {
  const f = (d: Date) => DateTime.fromJSDate(d, { zone: STOCKHOLM_TZ }).toFormat("HH.mm");
  return `${f(start)}–${f(end)}`;
}

/** "14.30" (svenskt format, i Stockholm-tid). */
export function formatTime(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: STOCKHOLM_TZ }).toFormat("HH.mm");
}

/** "lördag 28 november" (svenska, Stockholm). */
export function formatDateLong(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: STOCKHOLM_TZ })
    .setLocale("sv")
    .toFormat("cccc d LLLL");
}

/** "28 nov" (svenska, Stockholm) – kort form för tabeller. */
export function formatDateShort(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: STOCKHOLM_TZ })
    .setLocale("sv")
    .toFormat("d LLL")
    .replace(/\.$/, "");
}

/** "november 2026". */
export function formatMonthYear(year: number, month: number): string {
  return DateTime.fromObject({ year, month, day: 1 }, { zone: STOCKHOLM_TZ })
    .setLocale("sv")
    .toFormat("LLLL yyyy");
}
