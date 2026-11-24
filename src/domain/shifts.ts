import type { WorkCategory } from "./roles";
import { InvalidLocalTimeError, addDaysToDateString, isWholeMinute, localToInstant, minutesBetween } from "./time";

/** Längsta tillåtna pass. Längre pass är nästan säkert ett inmatningsfel. */
export const MAX_SHIFT_MINUTES = 16 * 60;

export type ShiftWorkStatusLike = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ABSENT";
export type ApprovalStatusLike =
  | "PENDING"
  | "APPROVED"
  | "CHANGE_REQUESTED"
  | "APPROVED_AFTER_SWAP";

export type ShiftIssueCode =
  | "INVALID_TIMES"
  | "MISSING_EMPLOYEE"
  | "EMPLOYEE_INACTIVE"
  | "CATEGORY_MISMATCH"
  | "OVERLAP"
  | "APPROVED_SHIFT_CHANGED"
  /** Passet har redan tagit slut (ändringen påverkar genomförda timmar). Varning. */
  | "ALREADY_ENDED"
  /** Passet har en tidsregistrering och kan inte ändras här. Fel. */
  | "HAS_TIME_ENTRY"
  /** Passet är inställt. Fel. */
  | "SHIFT_CANCELLED";

export type ShiftIssue = {
  code: ShiftIssueCode;
  /** error = får inte sparas. warning = får sparas efter bekräftelse. */
  severity: "error" | "warning";
  message: string;
  relatedShiftIds?: string[];
};

export type ShiftInterval = { id?: string; startsAt: Date; endsAt: Date };

export type ExistingShift = ShiftInterval & {
  id: string;
  workStatus: ShiftWorkStatusLike;
};

export type ShiftCandidate = ShiftInterval & {
  category: WorkCategory;
  assignedEmployeeId: string | null;
};

export type ShiftSnapshot = {
  startsAt: Date;
  endsAt: Date;
  category: WorkCategory;
  assignedEmployeeId: string;
  approvalStatus: ApprovalStatusLike;
};

/** Halvöppna intervall [start, slut): ett pass som slutar 15.00 krockar inte med ett som börjar 15.00. */
export function intervalsOverlap(a: ShiftInterval, b: ShiftInterval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Väsentlig ändring = ändrar vem, när eller var (kategori). Anteckningar räknas inte. */
export function isMaterialShiftChange(
  before: Pick<ShiftSnapshot, "startsAt" | "endsAt" | "category" | "assignedEmployeeId">,
  after: Pick<ShiftSnapshot, "startsAt" | "endsAt" | "category" | "assignedEmployeeId">,
): boolean {
  return (
    before.startsAt.getTime() !== after.startsAt.getTime() ||
    before.endsAt.getTime() !== after.endsAt.getTime() ||
    before.category !== after.category ||
    before.assignedEmployeeId !== after.assignedEmployeeId
  );
}

export function isApproved(status: ApprovalStatusLike): boolean {
  return status === "APPROVED" || status === "APPROVED_AFTER_SWAP";
}

/** Ett pass är genomfört först när sluttiden passerats. Framtida pass är aldrig genomförda. */
export function hasShiftEnded(shift: Pick<ShiftInterval, "endsAt">, now: Date): boolean {
  return shift.endsAt.getTime() <= now.getTime();
}

/**
 * Gör ett formulärs datum + klockslag (Stockholm-tid) till tidpunkter. Slutar passet nästa dag anges det uttryckligen
 * (`endsNextDay`), så att ett skrivfel som 15.00 → 11.00 aldrig tyst blir ett dygnslångt pass.
 */
export function buildShiftInterval(input: {
  date: string;
  from: string;
  to: string;
  endsNextDay?: boolean;
}): { ok: true; startsAt: Date; endsAt: Date } | { ok: false; issue: ShiftIssue } {
  try {
    const startsAt = localToInstant(input.date, input.from);
    const endsAt = localToInstant(input.endsNextDay ? addDaysToDateString(input.date, 1) : input.date, input.to);
    const issue = validateShiftTimes({ startsAt, endsAt });
    return issue ? { ok: false, issue } : { ok: true, startsAt, endsAt };
  } catch (e) {
    const message =
      e instanceof InvalidLocalTimeError
        ? "Klockslaget finns inte (sommartidsbyte). Välj en annan tid."
        : "Datum eller klockslag är ogiltigt.";
    return { ok: false, issue: { code: "INVALID_TIMES", severity: "error", message } };
  }
}

export function validateShiftTimes(interval: ShiftInterval): ShiftIssue | null {
  const { startsAt, endsAt } = interval;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { code: "INVALID_TIMES", severity: "error", message: "Start- eller sluttid saknas." };
  }
  if (endsAt <= startsAt) {
    return {
      code: "INVALID_TIMES",
      severity: "error",
      message: "Sluttiden måste vara efter starttiden.",
    };
  }
  if (!isWholeMinute(startsAt) || !isWholeMinute(endsAt)) {
    return {
      code: "INVALID_TIMES",
      severity: "error",
      message: "Tider måste anges i hela minuter.",
    };
  }
  if (minutesBetween(startsAt, endsAt) > MAX_SHIFT_MINUTES) {
    return {
      code: "INVALID_TIMES",
      severity: "error",
      message: `Ett pass får vara högst ${MAX_SHIFT_MINUTES / 60} timmar.`,
    };
  }
  return null;
}

/**
 * Automatiska kontroller vid schemaläggning (Admin). Ren funktion – serverlagret hämtar
 * data och anropar den, och databasen står dessutom för sista skyddet mot dubbelbokning.
 */
export function analyzeShift(input: {
  candidate: ShiftCandidate & { id?: string };
  employee: { id: string; category: WorkCategory; status: "ACTIVE" | "INACTIVE" } | null;
  /** Alla andra pass för samma anställd som kan krocka. */
  otherShiftsOfEmployee: readonly ExistingShift[];
  /** Passets tidigare tillstånd om det redigeras. */
  previous?: ShiftSnapshot;
}): ShiftIssue[] {
  const { candidate, employee, otherShiftsOfEmployee, previous } = input;
  const issues: ShiftIssue[] = [];

  const timeIssue = validateShiftTimes(candidate);
  if (timeIssue) issues.push(timeIssue);

  if (!candidate.assignedEmployeeId || !employee) {
    issues.push({
      code: "MISSING_EMPLOYEE",
      severity: "error",
      message: "Passet måste vara kopplat till en anställd.",
    });
  } else {
    if (employee.status !== "ACTIVE") {
      issues.push({
        code: "EMPLOYEE_INACTIVE",
        severity: "error",
        message: "Den anställde är inaktiverad och kan inte schemaläggas.",
      });
    }
    if (employee.category !== candidate.category) {
      issues.push({
        code: "CATEGORY_MISMATCH",
        severity: "error",
        message: "Den anställde tillhör en annan arbetskategori än passet.",
      });
    }
    if (!timeIssue) {
      const clashing = otherShiftsOfEmployee.filter(
        (s) => s.id !== candidate.id && s.workStatus !== "CANCELLED" && intervalsOverlap(candidate, s),
      );
      if (clashing.length > 0) {
        issues.push({
          code: "OVERLAP",
          severity: "error",
          message: "Den anställde har redan ett överlappande pass.",
          relatedShiftIds: clashing.map((s) => s.id),
        });
      }
    }
  }

  if (
    previous &&
    isApproved(previous.approvalStatus) &&
    candidate.assignedEmployeeId &&
    isMaterialShiftChange(previous, {
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      category: candidate.category,
      assignedEmployeeId: candidate.assignedEmployeeId,
    })
  ) {
    issues.push({
      code: "APPROVED_SHIFT_CHANGED",
      severity: "warning",
      message: "Passet är redan godkänt. Ändringen kräver nytt godkännande från den anställde.",
    });
  }

  return issues;
}

export function hasBlockingIssues(issues: readonly ShiftIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
