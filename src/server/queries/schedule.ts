import { type ShiftPhase, shiftMinutes, shiftPhase } from "@/domain/hours";
import type { WorkCategory } from "@/domain/roles";
import { dbDateToString, monthBounds } from "@/domain/time";
import type { DbClient } from "@/server/db-client";
import { type Actor, assertCan, fullName, toHourShift } from "./mappers";

export type ScheduleShift = {
  id: string;
  category: WorkCategory;
  /** Ansvarig just nu (får timmarna). Namnet kommer från personalregistret. */
  employeeId: string;
  employeeName: string;
  /** Den ansvariga är administratör som styr (admin-konto och inte timanställd). */
  employeeIsAdmin: boolean;
  /** Satt bara om passet bytt ägare: vem som ursprungligen tilldelades. */
  originalEmployeeName: string | null;
  startsAt: Date;
  endsAt: Date;
  localDate: string;
  minutes: number;
  publicationStatus: "DRAFT" | "PUBLISHED";
  approvalStatus: "PENDING" | "APPROVED" | "CHANGE_REQUESTED" | "APPROVED_AFTER_SWAP";
  workStatus: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ABSENT";
  phase: ShiftPhase;
  /** Fri notering på passet (t.ex. "öppnar"). */
  note: string | null;
};

const shiftSelect = {
  id: true,
  category: true,
  startsAt: true,
  endsAt: true,
  localDate: true,
  publicationStatus: true,
  approvalStatus: true,
  workStatus: true,
  notes: true,
  assignedEmployee: { select: { id: true, firstName: true, lastName: true, hourlyPaid: true, user: { select: { role: true } } } },
  originalEmployee: { select: { id: true, firstName: true, lastName: true } },
} as const;

type ShiftRow = {
  id: string;
  category: WorkCategory;
  startsAt: Date;
  endsAt: Date;
  localDate: Date;
  publicationStatus: ScheduleShift["publicationStatus"];
  approvalStatus: ScheduleShift["approvalStatus"];
  workStatus: ScheduleShift["workStatus"];
  notes: string | null;
  assignedEmployee: { id: string; firstName: string; lastName: string; hourlyPaid: boolean; user: { role: string } | null };
  originalEmployee: { id: string; firstName: string; lastName: string };
};

export function toScheduleShift(row: ShiftRow, now: Date): ScheduleShift {
  const hour = toHourShift(row);
  return {
    id: row.id,
    category: row.category,
    employeeId: row.assignedEmployee.id,
    employeeName: fullName(row.assignedEmployee),
    employeeIsAdmin: row.assignedEmployee.user?.role === "ADMIN" && !row.assignedEmployee.hourlyPaid,
    originalEmployeeName:
      row.originalEmployee.id === row.assignedEmployee.id ? null : fullName(row.originalEmployee),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    localDate: dbDateToString(row.localDate),
    minutes: shiftMinutes(hour),
    publicationStatus: row.publicationStatus,
    approvalStatus: row.approvalStatus,
    workStatus: row.workStatus,
    phase: shiftPhase(hour, now),
    note: row.notes,
  };
}

export { shiftSelect };

/**
 * Hela schemat för en månad (Admin). `category = null` ger båda grupperna samlat.
 * Varje pass bär den ansvariga personens namn, så namn och tid alltid hör ihop.
 */
export async function getScheduleMonth(
  db: DbClient,
  actor: Actor,
  input: { year: number; month: number; category?: WorkCategory | null; now?: Date },
): Promise<ScheduleShift[]> {
  assertCan(actor, "schedule:read:all");
  const now = input.now ?? new Date();
  const { start, end } = monthBounds(input.year, input.month);
  const rows = await db.shift.findMany({
    where: {
      startsAt: { gte: start, lt: end },
      ...(input.category ? { category: input.category } : {}),
    },
    select: shiftSelect,
    orderBy: [{ startsAt: "asc" }, { assignedEmployee: { lastName: "asc" } }],
  });
  return rows.map((r) => toScheduleShift(r, now));
}
