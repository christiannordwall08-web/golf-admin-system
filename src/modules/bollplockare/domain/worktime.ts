/**
 * Arbetstidsberäkning för bollplockare. Allt räknas i SEKUNDER från serverns tidsstämplar och avrundas först sist
 * till hela minuter (närmaste minut), så att tid över midnatt och sommar-/vintertid blir rätt (instant-aritmetik).
 */
export type PauseLike = { startedAt: Date; endedAt: Date | null; voided?: boolean };

const toSec = (d: Date) => d.getTime() / 1000;
const minutes = (seconds: number) => Math.round(seconds / 60);

/** Summan av pausernas längd inom [from, to], utan dubbelräkning av överlapp. Ogiltigförklarade pauser räknas inte. En öppen paus löper till `to`. */
export function pausedSecondsBetween(pauses: readonly PauseLike[], from: Date, to: Date): number {
  const a = toSec(from);
  const b = toSec(to);
  const spans = pauses
    .filter((p) => !p.voided)
    .map((p) => [Math.max(a, toSec(p.startedAt)), Math.min(b, p.endedAt ? toSec(p.endedAt) : b)] as const)
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curEnd = -Infinity;
  for (const [s, e] of spans) {
    const start = Math.max(s, curEnd);
    if (e > start) total += e - start;
    curEnd = Math.max(curEnd, e);
  }
  return total;
}

export type SessionTotals = {
  totalSeconds: number;
  pausedSeconds: number;
  workedSeconds: number;
  totalMinutes: number;
  pausedMinutes: number;
  /** Registrerad arbetstid i hela minuter = (total − paus), avrundad en gång. */
  registeredMinutes: number;
};

/** Total tid, paustid och registrerad arbetstid för ett pass. Negativa tider förekommer aldrig. */
export function sessionTotals(input: { startedAt: Date; endedAt: Date; pauses: readonly PauseLike[] }): SessionTotals {
  const totalSeconds = Math.max(0, toSec(input.endedAt) - toSec(input.startedAt));
  const pausedSeconds = Math.min(totalSeconds, pausedSecondsBetween(input.pauses, input.startedAt, input.endedAt));
  const workedSeconds = totalSeconds - pausedSeconds;
  return {
    totalSeconds,
    pausedSeconds,
    workedSeconds,
    totalMinutes: minutes(totalSeconds),
    pausedMinutes: minutes(pausedSeconds),
    registeredMinutes: minutes(workedSeconds),
  };
}

/** Pågående arbetstid just nu (för timern). Pausad tid ingår inte. */
export function liveWorkedSeconds(startedAt: Date, pauses: readonly PauseLike[], now: Date): number {
  const total = Math.max(0, toSec(now) - toSec(startedAt));
  return Math.max(0, total - pausedSecondsBetween(pauses, startedAt, now));
}

export type WorkState =
  | "SCHEDULED"
  | "AWAITING_CHECK_IN"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "CANCELLED";

export const WORK_STATE_LABEL: Record<WorkState, string> = {
  SCHEDULED: "Schemalagt",
  AWAITING_CHECK_IN: "Inväntar incheckning",
  ACTIVE: "Aktivt",
  PAUSED: "Geografiskt pausat",
  COMPLETED: "Slutfört",
  NEEDS_REVIEW: "Kräver granskning",
  APPROVED: "Godkänt",
  CANCELLED: "Avbokat",
};

/** Passets huvudtillstånd, härlett ur sparade fakta. GPS-status ingår medvetet inte: den påverkar aldrig tillståndet. */
export function deriveWorkState(input: {
  now: Date;
  cancelled: boolean;
  earliestCheckIn: Date | null;
  entry: { endedAt: Date | null; openPause: boolean; status: "PRELIMINARY" | "APPROVED" | "CORRECTED" | "ABSENT" | "VOID"; needsReview: boolean } | null;
}): WorkState {
  if (input.cancelled) return "CANCELLED";
  const e = input.entry;
  if (!e) return input.earliestCheckIn && input.now >= input.earliestCheckIn ? "AWAITING_CHECK_IN" : "SCHEDULED";
  if (!e.endedAt) return e.openPause ? "PAUSED" : "ACTIVE";
  if (e.status === "APPROVED" || e.status === "CORRECTED") return "APPROVED";
  return e.needsReview ? "NEEDS_REVIEW" : "COMPLETED";
}
