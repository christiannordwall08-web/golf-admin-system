import type { WorkCategory } from "./roles";
import { type ExistingShift, intervalsOverlap } from "./shifts";

/**
 * Lediga pass: vem får ta ett pass, och när godkänns ett passbyte automatiskt. Rena funktioner utan databas.
 * Serverlagret hämtar data och anropar dem; databasen står för sista skyddet (överlapp, en antagen anmälan per pass).
 *
 * Här är också platsen för framtida arbetstidsregler (minderåriga, dygnsvila, max per vecka): lägg till dem i
 * `openShiftEligibility` så gäller de automatiskt både för notiser, listor och när någon tar passet.
 */

export type OpenShiftStatusLike = "OPEN" | "FILLED" | "CANCELLED";

export type EligibilityReason = "NOT_OPEN" | "ALREADY_STARTED" | "NO_EMPLOYMENT" | "INACTIVE" | "CATEGORY_MISMATCH" | "OVERLAP";

export type Eligibility = { eligible: true } | { eligible: false; reason: EligibilityReason; message: string };

const MESSAGES: Record<EligibilityReason, string> = {
  NOT_OPEN: "Passet är inte längre ledigt.",
  ALREADY_STARTED: "Passet har redan börjat.",
  NO_EMPLOYMENT: "Du har ingen anställning i den här gruppen.",
  INACTIVE: "Din anställning är inte aktiv.",
  CATEGORY_MISMATCH: "Passet hör till en annan grupp.",
  OVERLAP: "Du har redan ett pass som krockar med det här.",
};

const no = (reason: EligibilityReason): Eligibility => ({
  eligible: false,
  reason,
  message: MESSAGES[reason],
});

/** Får den här anställda ta det lediga passet just nu? Kontrollerna sker i ordning, första hindret returneras. */
export function openShiftEligibility(input: {
  openShift: {
    category: WorkCategory;
    status: OpenShiftStatusLike;
    startsAt: Date;
    endsAt: Date;
  };
  employee: { category: WorkCategory; status: "ACTIVE" | "INACTIVE" } | null;
  /** Den anställdas övriga pass som kan krocka (inställda räknas inte). */
  otherShifts: readonly Pick<ExistingShift, "startsAt" | "endsAt" | "workStatus">[];
  now: Date;
}): Eligibility {
  const { openShift, employee, otherShifts, now } = input;
  if (openShift.status !== "OPEN") return no("NOT_OPEN");
  if (openShift.startsAt <= now) return no("ALREADY_STARTED");
  if (!employee) return no("NO_EMPLOYMENT");
  if (employee.status !== "ACTIVE") return no("INACTIVE");
  if (employee.category !== openShift.category) return no("CATEGORY_MISMATCH");
  if (otherShifts.some((s) => s.workStatus !== "CANCELLED" && intervalsOverlap(openShift, s))) return no("OVERLAP");
  return { eligible: true };
}

/**
 * Godkänns ett passbyte automatiskt när en kollega tackat ja? Bara om Admin slagit på det, och bara för byten där
 * en kollega tar över ett pass (DIRECT, OPEN). Dagsbyten (två pass) och ändringsbegäranden avgörs alltid av Admin.
 * Själva kontrollen av överlapp m.m. görs ändå vid godkännandet; misslyckas den går förfrågan till Admin som vanligt.
 */
export function isSwapAutoApprovable(kind: "DIRECT" | "OPEN" | "EXCHANGE" | "CHANGE", autoApproveSwaps: boolean): boolean {
  return autoApproveSwaps && (kind === "DIRECT" || kind === "OPEN");
}

export const OPEN_SHIFT_STATUS_LABEL: Record<OpenShiftStatusLike, string> = {
  OPEN: "Ledigt",
  FILLED: "Tillsatt",
  CANCELLED: "Indraget",
};

export const CLAIM_STATUS_LABEL: Record<"PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN", string> = {
  PENDING: "Intresseanmäld",
  ACCEPTED: "Fick passet",
  REJECTED: "Fick inte passet",
  WITHDRAWN: "Återkallad",
};
