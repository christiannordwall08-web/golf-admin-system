import { estimateCompensation, nextShift, summarizeShifts } from "@/domain/hours";
import { resolveRateForDate } from "@/domain/pay-rates";
import type { WorkCategory } from "@/domain/roles";
import { monthParam, shiftMonth } from "@/domain/calendar";
import { compensationOre } from "@/domain/money";
import { dateStringToDbDate, monthBounds, stockholmDateOf } from "@/domain/time";
import type { DbClient } from "@/server/db-client";
import { type Actor, assertCan, compareNames, fullName, toHourShift, toRatePeriods } from "./mappers";

export type PersonnelRow = {
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  category: WorkCategory;
  status: "ACTIVE" | "INACTIVE";
  /**
   * Administratör som styr över de anställda: kontot har admin-åtkomst OCH personen är inte timanställd.
   * En admin som själv är timanställd räknas bland de anställda (så att hens timlön och timmar syns som vanligt).
   */
  isAdmin: boolean;
  /** false = ingår inte i timlön/löneunderlag (visas som "Ej timlön", aldrig som "Lön saknas"). */
  hourlyPaid: boolean;
  /** Fast månadslön (visas som "Fast lön"). Bara möjligt när `hourlyPaid` är false. */
  fixedSalary: boolean;
  /** Gällande timlön idag (ören), null om ingen lön är satt. */
  hourlyRateOre: number | null;
  /** Genomfört enligt schema (ej godkänd tid). */
  completedMinutes: number;
  /** Återstående schemalagt i månaden (inkl. pågående). */
  remainingMinutes: number;
  totalMinutes: number;
  /** Preliminär ersättning för genomförda pass (ej godkänd). */
  estimatedCompensationOre: number;
  shiftsMissingRate: number;
  nextShift: { startsAt: Date; endsAt: Date } | null;
};

export type PersonnelTotals = {
  /** Anställda som inte är administratörer. */
  employees: number;
  /** Administratörer (som också står i schemat). */
  admins: number;
  /** Timmar och ersättning gäller bara personer som ingår i timlön (`hourlyPaid`). */
  completedMinutes: number;
  remainingMinutes: number;
  totalMinutes: number;
  estimatedCompensationOre: number;
  /** Genomförda pass där ingen timlön gällde. De ingår INTE i ersättningen. */
  shiftsMissingRate: number;
  byCategory: Record<WorkCategory, { employees: number; admins: number; completedMinutes: number; remainingMinutes: number }>;
};

/**
 * Personalöversikt för Admin: alla anställda med timlön, arbetade (enligt schema) och kommande
 * timmar för vald månad samt preliminär ersättning. Endast Admin (`employees:read:all`,
 * `payrates:read:all`, `worktime:read:all`). Allt hämtas från databasen.
 */
export async function getPersonnelOverview(
  db: DbClient,
  actor: Actor,
  input: { year: number; month: number; category?: WorkCategory | null; search?: string; now?: Date },
): Promise<{ rows: PersonnelRow[]; totals: PersonnelTotals }> {
  assertCan(actor, "employees:read:all", "payrates:read:all", "worktime:read:all");
  const now = input.now ?? new Date();
  const { start, end } = monthBounds(input.year, input.month);
  const terms = (input.search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);

  const employees = await db.employee.findMany({
    where: {
      status: "ACTIVE",
      ...(input.category ? { category: input.category } : {}),
      AND: terms.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    include: { payRates: true, user: { select: { role: true } } },
  });
  const ids = employees.map((e) => e.id);

  const [monthShifts, upcoming] = await Promise.all([
    db.shift.findMany({
      where: { assignedEmployeeId: { in: ids }, startsAt: { gte: start, lt: end } },
      select: { id: true, assignedEmployeeId: true, startsAt: true, endsAt: true, localDate: true, workStatus: true, openEnded: true },
    }),
    db.shift.findMany({
      where: {
        assignedEmployeeId: { in: ids },
        endsAt: { gt: now },
        workStatus: { notIn: ["CANCELLED", "ABSENT"] },
      },
      select: { id: true, assignedEmployeeId: true, startsAt: true, endsAt: true, localDate: true, workStatus: true, openEnded: true },
      orderBy: { startsAt: "asc" },
      take: 5000,
    }),
  ]);

  // Bollplockare har ingen schemalagd arbetstid: deras tid är den REGISTRERADE (klocka in/ut), godkänd om admin godkänt den.
  const bollIds = employees.filter((e) => e.category === "BOLLPLOCKARE").map((e) => e.id);
  const ym = { year: input.year, month: input.month };
  const workEntries = bollIds.length
    ? await db.workTimeEntry.findMany({
        where: {
          employeeId: { in: bollIds },
          source: "GPS",
          registeredEndsAt: { not: null },
          workDate: { gte: dateStringToDbDate(`${monthParam(ym)}-01`), lt: dateStringToDbDate(`${monthParam(shiftMonth(ym, 1))}-01`) },
        },
        select: { employeeId: true, registeredMinutes: true, approvedMinutes: true },
      })
    : [];

  const byEmployee = new Map<string, typeof monthShifts>();
  for (const s of monthShifts) byEmployee.set(s.assignedEmployeeId, [...(byEmployee.get(s.assignedEmployeeId) ?? []), s]);
  const nextByEmployee = new Map<string, (typeof upcoming)[number]>();
  for (const s of upcoming) if (!nextByEmployee.has(s.assignedEmployeeId)) nextByEmployee.set(s.assignedEmployeeId, s);

  const today = stockholmDateOf(now);
  const rows: PersonnelRow[] = employees.map((e) => {
    const shifts = (byEmployee.get(e.id) ?? []).map(toHourShift);
    const rates = toRatePeriods(e.payRates);
    const summary = summarizeShifts(shifts, now);
    const comp = estimateCompensation(shifts, rates, now);
    const next = nextByEmployee.get(e.id);
    const worked = workEntries.filter((w) => w.employeeId === e.id).reduce((n, w) => n + (w.approvedMinutes ?? w.registeredMinutes), 0);
    const rateNow = resolveRateForDate(rates, today)?.hourlyRateOre ?? null;
    // Pass utan fast sluttid ger 0 schemalagda minuter; deras faktiska (registrerade) tid läggs till här.
    const workedComp = e.hourlyPaid && rateNow !== null ? compensationOre(worked, rateNow) : 0;
    return {
      employeeId: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      fullName: fullName(e),
      category: e.category,
      status: e.status,
      isAdmin: e.user?.role === "ADMIN" && !e.hourlyPaid,
      hourlyPaid: e.hourlyPaid,
      fixedSalary: e.fixedSalary,
      hourlyRateOre: resolveRateForDate(rates, today)?.hourlyRateOre ?? null,
      completedMinutes: summary.completedMinutes + worked,
      remainingMinutes: summary.remainingMinutes,
      totalMinutes: summary.totalMinutes + worked,
      estimatedCompensationOre: comp.compensationOre + workedComp,
      shiftsMissingRate: comp.shiftsMissingRate,
      nextShift: next ? { startsAt: next.startsAt, endsAt: next.endsAt } : null,
    };
  });
  rows.sort(compareNames);

  const totals: PersonnelTotals = {
    employees: 0,
    admins: 0,
    completedMinutes: 0,
    remainingMinutes: 0,
    totalMinutes: 0,
    estimatedCompensationOre: 0,
    shiftsMissingRate: 0,
    byCategory: {
      GOLFSHOP: { employees: 0, admins: 0, completedMinutes: 0, remainingMinutes: 0 },
      BOLLPLOCKARE: { employees: 0, admins: 0, completedMinutes: 0, remainingMinutes: 0 },
    },
  };
  for (const r of rows) {
    const c = totals.byCategory[r.category];
    if (r.isAdmin) {
      totals.admins++;
      c.admins++;
    } else {
      totals.employees++;
      c.employees++;
    }
    // Timmar och pengar räknas bara för dem som ingår i timlön.
    if (!r.hourlyPaid) continue;
    totals.completedMinutes += r.completedMinutes;
    totals.remainingMinutes += r.remainingMinutes;
    totals.totalMinutes += r.totalMinutes;
    totals.estimatedCompensationOre += r.estimatedCompensationOre;
    totals.shiftsMissingRate += r.shiftsMissingRate;
    c.completedMinutes += r.completedMinutes;
    c.remainingMinutes += r.remainingMinutes;
  }
  return { rows, totals };
}

export { nextShift };
