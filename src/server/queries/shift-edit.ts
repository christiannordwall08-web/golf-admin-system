import { type ShiftPhase, shiftMinutes, shiftPhase } from "@/domain/hours";
import type { WorkCategory } from "@/domain/roles";
import { dbDateToString, localTimeOf, stockholmDateOf } from "@/domain/time";
import type { DbClient } from "@/server/db-client";
import { NotFoundError } from "@/server/errors";
import { type Actor, assertCan, compareNames, fullName, toHourShift } from "./mappers";

export type EditableShift = {
  id: string;
  version: number;
  category: WorkCategory;
  employeeId: string;
  employeeName: string;
  /** Satt bara om passet bytt ägare. */
  originalEmployeeName: string | null;
  /** Stockholm-datum och klockslag, färdiga för formulärfält. */
  date: string;
  from: string;
  to: string;
  endsNextDay: boolean;
  minutes: number;
  notes: string | null;
  publicationStatus: "DRAFT" | "PUBLISHED";
  approvalStatus: "PENDING" | "APPROVED" | "CHANGE_REQUESTED" | "APPROVED_AFTER_SWAP";
  workStatus: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ABSENT";
  phase: ShiftPhase;
  /** Passet har en tidsregistrering och kan inte ändras här. */
  hasTimeEntry: boolean;
  history: { at: Date; reason: "INITIAL" | "ADMIN_REASSIGNMENT" | "SHIFT_SWAP" | "OPEN_SHIFT"; fromName: string | null; toName: string; byName: string }[];
};

/** Ett pass med allt som behövs för att ändra det (Admin). */
export async function getShiftForEdit(db: DbClient, actor: Actor, shiftId: string, now: Date = new Date()): Promise<EditableShift> {
  assertCan(actor, "schedule:read:all", "schedule:write");
  const s = await db.shift.findUnique({
    where: { id: shiftId },
    include: {
      assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      originalEmployee: { select: { id: true, firstName: true, lastName: true } },
      workTimeEntry: { select: { id: true } },
      assignmentHistory: {
        orderBy: { createdAt: "asc" },
        include: {
          fromEmployee: { select: { firstName: true, lastName: true } },
          toEmployee: { select: { firstName: true, lastName: true } },
          changedBy: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!s) throw new NotFoundError("Passet finns inte.");
  const hour = toHourShift(s);
  return {
    id: s.id,
    version: s.version,
    category: s.category,
    employeeId: s.assignedEmployee.id,
    employeeName: fullName(s.assignedEmployee),
    originalEmployeeName: s.originalEmployee.id === s.assignedEmployee.id ? null : fullName(s.originalEmployee),
    date: dbDateToString(s.localDate),
    from: localTimeOf(s.startsAt),
    to: localTimeOf(s.endsAt),
    endsNextDay: stockholmDateOf(s.endsAt) !== stockholmDateOf(s.startsAt),
    minutes: shiftMinutes(hour),
    notes: s.notes,
    publicationStatus: s.publicationStatus,
    approvalStatus: s.approvalStatus,
    workStatus: s.workStatus,
    phase: shiftPhase(hour, now),
    hasTimeEntry: s.workTimeEntry !== null,
    history: s.assignmentHistory.map((h) => ({
      at: h.createdAt,
      reason: h.reason,
      fromName: h.fromEmployee ? fullName(h.fromEmployee) : null,
      toName: fullName(h.toEmployee),
      byName: h.changedBy.name ?? h.changedBy.email,
    })),
  };
}

export type SchedulableEmployee = { id: string; name: string; category: WorkCategory; isAdmin: boolean };

/** Aktiva anställda som kan schemaläggas, sorterade per grupp och namn. */
export async function listSchedulableEmployees(db: DbClient, actor: Actor): Promise<SchedulableEmployee[]> {
  assertCan(actor, "schedule:write");
  const rows = await db.employee.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true, category: true, hourlyPaid: true, user: { select: { role: true } } },
  });
  return rows
    .sort((a, b) => a.category.localeCompare(b.category) || compareNames(a, b))
    .map((e) => ({ id: e.id, name: fullName(e), category: e.category, isAdmin: e.user?.role === "ADMIN" && !e.hourlyPaid }));
}
