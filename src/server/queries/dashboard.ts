import { stockholmDateOf, dayBounds, monthBounds, stockholmYearMonth } from "@/domain/time";
import type { DbClient } from "@/server/db-client";
import { type Actor, assertCan } from "./mappers";
import { type PersonnelTotals, getPersonnelOverview } from "./personnel";
import { type ScheduleShift, shiftSelect, toScheduleShift } from "./schedule";

export type AdminDashboard = {
  year: number;
  month: number;
  /** Anställda (utan administratörer) per grupp, samt antal administratörer. */
  employees: { total: number; golfshop: number; bollplockare: number; admins: number };
  /** Timmar och preliminär ersättning för månaden, enligt schema (ej godkänt). */
  monthTotals: PersonnelTotals;
  /** Godkända timmar i månaden (WorkTimeEntry). 0 tills godkännande byggs (Etapp 4). */
  approvedMinutes: number;
  /** Pass som överlappar idag. */
  today: ScheduleShift[];
  /** Kommande pass närmaste dagarna (efter nu). */
  upcoming: ScheduleShift[];
  actions: {
    /** Publicerade framtida pass som ännu inte godkänts av den anställde. */
    pendingApprovals: number;
    /** Framtida pass som fortfarande är utkast (ej publicerade). */
    draftShifts: number;
    openSwapRequests: number;
  };
};

/** Adminöversikt. Allt är riktiga databassiffror; inget hittas på. */
export async function getAdminDashboard(db: DbClient, actor: Actor, now: Date = new Date()): Promise<AdminDashboard> {
  assertCan(actor, "employees:read:all", "payrates:read:all", "worktime:read:all", "schedule:read:all", "swap:read:all");
  const { year, month } = stockholmYearMonth(now);
  const day = dayBounds(stockholmDateOf(now));
  const { start: monthStart, end: monthEnd } = monthBounds(year, month);
  const active = { notIn: ["CANCELLED", "ABSENT"] as ("CANCELLED" | "ABSENT")[] };

  const [overview, approved, todayRows, upcomingRows, pendingApprovals, draftShifts, openSwapRequests] = await Promise.all([
    getPersonnelOverview(db, actor, { year, month, now }),
    db.workTimeEntry.aggregate({
      where: { status: { in: ["APPROVED", "CORRECTED"] }, workDate: { gte: monthStart, lt: monthEnd } },
      _sum: { approvedMinutes: true },
    }),
    db.shift.findMany({
      where: { startsAt: { lt: day.end }, endsAt: { gt: day.start }, workStatus: { not: "CANCELLED" } },
      select: shiftSelect,
      orderBy: [{ startsAt: "asc" }, { assignedEmployee: { lastName: "asc" } }],
    }),
    db.shift.findMany({
      where: { startsAt: { gt: now }, workStatus: active },
      select: shiftSelect,
      orderBy: { startsAt: "asc" },
      take: 8,
    }),
    db.shift.count({ where: { publicationStatus: "PUBLISHED", approvalStatus: "PENDING", endsAt: { gt: now }, workStatus: active } }),
    db.shift.count({ where: { publicationStatus: "DRAFT", endsAt: { gt: now }, workStatus: active } }),
    db.shiftSwapRequest.count({ where: { status: { in: ["AWAITING_COLLEAGUE", "AWAITING_ADMIN"] } } }),
  ]);

  const { golfshop, bollplockare } = {
    golfshop: overview.totals.byCategory.GOLFSHOP.employees,
    bollplockare: overview.totals.byCategory.BOLLPLOCKARE.employees,
  };
  return {
    year,
    month,
    employees: { total: golfshop + bollplockare, golfshop, bollplockare, admins: overview.totals.admins },
    monthTotals: overview.totals,
    approvedMinutes: approved._sum.approvedMinutes ?? 0,
    today: todayRows.map((r) => toScheduleShift(r, now)),
    upcoming: upcomingRows.map((r) => toScheduleShift(r, now)),
    actions: { pendingApprovals, draftShifts, openSwapRequests },
  };
}
