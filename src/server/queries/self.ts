import { type HourShift, type HoursSummary, estimateCompensation, shiftMinutes, shiftPhase, summarizeShifts, type ShiftPhase } from "@/domain/hours";
import { can, type WorkCategory } from "@/domain/roles";
import { dbDateToString, monthBounds } from "@/domain/time";
import type { DbClient } from "@/server/db-client";
import { ForbiddenError } from "@/server/errors";
import { type Actor, assertCan, toHourShift, toRatePeriods } from "./mappers";

export type MyShift = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  localDate: string;
  minutes: number;
  phase: ShiftPhase;
  workStatus: HourShift["workStatus"];
  approvalStatus: "PENDING" | "APPROVED" | "CHANGE_REQUESTED" | "APPROVED_AFTER_SWAP";
  note: string | null;
};

export type MyMonth = {
  employeeId: string;
  firstName: string;
  category: WorkCategory;
  summary: HoursSummary;
  shifts: MyShift[];
  next: MyShift | null;
  /** Publicerade framtida pass som väntar på mitt godkännande. */
  pendingApprovals: number;
  /** Bara om Admin slagit på visning av ersättning för den anställde, annars null. */
  estimatedCompensationOre: number | null;
};

/**
 * Den inloggade anställdas egen månad. Datat avgränsas HÄR till anställningar som tillhör
 * inloggad användare (`userId` från sessionen), så ingen kan läsa en annan persons pass genom
 * att ändra ett id. Bara PUBLICERADE pass visas för personalen (utkast är bara för Admin).
 */
export async function getMyMonth(
  db: DbClient,
  actor: Actor,
  input: { userId: string; employeeId: string; year: number; month: number; now?: Date },
): Promise<MyMonth> {
  assertCan(actor, "shift:read:own");
  const now = input.now ?? new Date();
  const { start, end } = monthBounds(input.year, input.month);

  const employee = await db.employee.findFirst({
    where: { id: input.employeeId, userId: input.userId, status: "ACTIVE" },
    include: { payRates: true },
  });
  if (!employee) throw new ForbiddenError();

  const published = { publicationStatus: "PUBLISHED" as const };
  const select = { id: true, startsAt: true, endsAt: true, localDate: true, workStatus: true, approvalStatus: true, notes: true };
  const [rows, upcoming, pendingApprovals] = await Promise.all([
    db.shift.findMany({
      where: { assignedEmployeeId: employee.id, startsAt: { gte: start, lt: end }, ...published },
      select,
      orderBy: { startsAt: "asc" },
    }),
    db.shift.findMany({
      where: { assignedEmployeeId: employee.id, endsAt: { gt: now }, workStatus: { notIn: ["CANCELLED", "ABSENT"] }, ...published },
      select,
      orderBy: { startsAt: "asc" },
      take: 1,
    }),
    db.shift.count({
      where: { assignedEmployeeId: employee.id, approvalStatus: "PENDING", endsAt: { gt: now }, workStatus: { notIn: ["CANCELLED", "ABSENT"] }, ...published },
    }),
  ]);

  const toMy = (row: (typeof rows)[number]): MyShift => {
    const h = toHourShift(row);
    return {
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      localDate: dbDateToString(row.localDate),
      minutes: shiftMinutes(h),
      phase: shiftPhase(h, now),
      workStatus: row.workStatus,
      approvalStatus: row.approvalStatus,
      note: row.notes,
    };
  };
  const hourShifts = rows.map(toHourShift);
  // Personalen ser bara sin EGEN ersättning, och bara om Admin slagit på det.
  const earnings =
    employee.showEarningsToEmployee && can(actor.role, "worktime:read:own")
      ? estimateCompensation(hourShifts, toRatePeriods(employee.payRates), now).compensationOre
      : null;

  return {
    employeeId: employee.id,
    firstName: employee.firstName,
    category: employee.category,
    summary: summarizeShifts(hourShifts, now),
    shifts: rows.map(toMy),
    next: upcoming[0] ? toMy(upcoming[0]) : null,
    pendingApprovals,
    estimatedCompensationOre: earnings,
  };
}
