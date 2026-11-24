import { compensationOre, sumOre } from "./money";
import { type RatePeriod, resolveRateForDate } from "./pay-rates";
import { minutesBetween } from "./time";

/**
 * Timmar och preliminär ersättning enligt SCHEMAT. Detta är INTE godkänd arbetstid:
 * godkännande (WorkTimeEntry.approvedMinutes) kommer i Etapp 4. Här gäller:
 *  - Genomfört = passets sluttid har passerat. Framtida pass är aldrig genomförda.
 *  - Återstående = ej slut än (pågående räknas hit). Inställda och frånvaro-pass räknas inte alls.
 *  - Ett pass hör till månaden där det BÖRJAR (Stockholm-tid).
 *  - Preliminär ersättning räknas bara på genomförda pass, med lönen som gällde passets arbetsdag.
 */
export type HourShift = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** Stockholm-datum "YYYY-MM-DD" för starttiden. */
  localDate: string;
  workStatus: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ABSENT";
};

export type ShiftPhase = "COMPLETED" | "ONGOING" | "UPCOMING" | "CANCELLED" | "ABSENT";

export function shiftPhase(shift: HourShift, now: Date): ShiftPhase {
  if (shift.workStatus === "CANCELLED") return "CANCELLED";
  if (shift.workStatus === "ABSENT") return "ABSENT";
  if (shift.endsAt.getTime() <= now.getTime()) return "COMPLETED";
  if (shift.startsAt.getTime() <= now.getTime()) return "ONGOING";
  return "UPCOMING";
}

export function shiftMinutes(shift: Pick<HourShift, "startsAt" | "endsAt">): number {
  return minutesBetween(shift.startsAt, shift.endsAt);
}

export type HoursSummary = {
  completedMinutes: number;
  remainingMinutes: number;
  totalMinutes: number;
  completedCount: number;
  remainingCount: number;
};

export function summarizeShifts(shifts: readonly HourShift[], now: Date): HoursSummary {
  const summary: HoursSummary = { completedMinutes: 0, remainingMinutes: 0, totalMinutes: 0, completedCount: 0, remainingCount: 0 };
  for (const shift of shifts) {
    const phase = shiftPhase(shift, now);
    if (phase === "COMPLETED") {
      summary.completedMinutes += shiftMinutes(shift);
      summary.completedCount++;
    } else if (phase === "ONGOING" || phase === "UPCOMING") {
      summary.remainingMinutes += shiftMinutes(shift);
      summary.remainingCount++;
    }
  }
  summary.totalMinutes = summary.completedMinutes + summary.remainingMinutes;
  return summary;
}

export type CompensationEstimate = {
  compensationOre: number;
  /** Genomförda pass där ingen timlön gällde (de ger 0 kr och bör uppmärksammas). */
  shiftsMissingRate: number;
};

/** Preliminär ersättning för genomförda pass. Avrundas en gång per pass. */
export function estimateCompensation(
  shifts: readonly HourShift[],
  rates: readonly RatePeriod[],
  now: Date,
): CompensationEstimate {
  const amounts: number[] = [];
  let missing = 0;
  for (const shift of shifts) {
    if (shiftPhase(shift, now) !== "COMPLETED") continue;
    const rate = resolveRateForDate(rates, shift.localDate);
    if (!rate) {
      missing++;
      continue;
    }
    amounts.push(compensationOre(shiftMinutes(shift), rate.hourlyRateOre));
  }
  return { compensationOre: Number(sumOre(amounts)), shiftsMissingRate: missing };
}

/** Nästa pass som inte tagit slut (pågående räknas som nästa). */
export function nextShift<T extends HourShift>(shifts: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const shift of shifts) {
    const phase = shiftPhase(shift, now);
    if (phase !== "ONGOING" && phase !== "UPCOMING") continue;
    if (!best || shift.startsAt < best.startsAt) best = shift;
  }
  return best;
}
