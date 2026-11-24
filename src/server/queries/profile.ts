import { type HourShift, type ShiftPhase, estimateCompensation, summarizeShifts, shiftMinutes, shiftPhase } from "@/domain/hours";
import { compensationOre } from "@/domain/money";
import { type RatePeriod, resolveRateForDate } from "@/domain/pay-rates";
import type { WorkCategory } from "@/domain/roles";
import { dbDateToString, monthBounds } from "@/domain/time";
import type { DbClient } from "@/server/db-client";
import { NotFoundError } from "@/server/errors";
import { type Actor, assertCan, toHourShift, toRatePeriods } from "./mappers";

export type ProfileShift = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  localDate: string;
  minutes: number;
  phase: ShiftPhase;
  workStatus: HourShift["workStatus"];
  approvalStatus: "PENDING" | "APPROVED" | "CHANGE_REQUESTED" | "APPROVED_AFTER_SWAP";
  note: string | null;
  /** Timlön som gäller passets arbetsdag, och preliminär ersättning (bara för genomförda pass). */
  hourlyRateOre: number | null;
  estimatedCompensationOre: number | null;
};

export type EmployeeProfile = {
  employeeId: string;
  firstName: string;
  lastName: string;
  category: WorkCategory;
  status: "ACTIVE" | "INACTIVE";
  isAdmin: boolean;
  hourlyPaid: boolean;
  email: string | null;
  phone: string | null;
  employmentStartDate: string | null;
  /** Andra anställningar för samma person (t.ex. Bollplockare om detta är Golfshop). */
  otherEmploymentCategories: WorkCategory[];
  currentHourlyRateOre: number | null;
  rateHistory: RatePeriod[];
  month: { year: number; month: number };
  summary: ReturnType<typeof summarizeShifts>;
  estimatedCompensationOre: number;
  shiftsMissingRate: number;
  shifts: ProfileShift[];
};

/** Admins personalprofil för en anställd och en månad. */
export async function getEmployeeProfile(
  db: DbClient,
  actor: Actor,
  employeeId: string,
  input: { year: number; month: number; now?: Date },
): Promise<EmployeeProfile> {
  assertCan(actor, "employees:read:all", "payrates:read:all", "worktime:read:all");
  const now = input.now ?? new Date();
  const { start, end } = monthBounds(input.year, input.month);

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { payRates: { orderBy: { validFrom: "asc" } }, user: { select: { role: true, employees: { select: { id: true, category: true } } } } },
  });
  if (!employee) throw new NotFoundError("Den anställde finns inte.");

  const rows = await db.shift.findMany({
    where: { assignedEmployeeId: employeeId, startsAt: { gte: start, lt: end } },
    select: { id: true, startsAt: true, endsAt: true, localDate: true, workStatus: true, approvalStatus: true, notes: true },
    orderBy: { startsAt: "asc" },
  });

  const rates = toRatePeriods(employee.payRates);
  const hourShifts = rows.map(toHourShift);
  const comp = estimateCompensation(hourShifts, rates, now);
  const shifts: ProfileShift[] = rows.map((row, i) => {
    const h = hourShifts[i];
    const phase = shiftPhase(h, now);
    const rate = resolveRateForDate(rates, h.localDate);
    return {
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      localDate: dbDateToString(row.localDate),
      minutes: shiftMinutes(h),
      phase,
      workStatus: row.workStatus,
      approvalStatus: row.approvalStatus,
      note: row.notes,
      hourlyRateOre: rate?.hourlyRateOre ?? null,
      estimatedCompensationOre: phase === "COMPLETED" && rate ? compensationOre(shiftMinutes(h), rate.hourlyRateOre) : null,
    };
  });

  const today = dbDateToString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
  return {
    employeeId: employee.id,
    firstName: employee.firstName,
    lastName: employee.lastName,
    category: employee.category,
    status: employee.status,
    isAdmin: employee.user?.role === "ADMIN" && !employee.hourlyPaid,
    hourlyPaid: employee.hourlyPaid,
    email: employee.email,
    phone: employee.phone,
    employmentStartDate: employee.employmentStartDate ? dbDateToString(employee.employmentStartDate) : null,
    otherEmploymentCategories: (employee.user?.employees ?? []).filter((e) => e.id !== employee.id).map((e) => e.category),
    currentHourlyRateOre: resolveRateForDate(rates, today)?.hourlyRateOre ?? null,
    rateHistory: rates,
    month: { year: input.year, month: input.month },
    summary: summarizeShifts(hourShifts, now),
    estimatedCompensationOre: comp.compensationOre,
    shiftsMissingRate: comp.shiftsMissingRate,
    shifts,
  };
}
