import { DateTime } from "luxon";
import { type YearMonth, shiftMonth } from "@/domain/calendar";
import type { WorkCategory } from "@/domain/roles";
import { STOCKHOLM_TZ, dateStringToDbDate, localToInstant, stockholmDateOf, stockholmYearMonth } from "@/domain/time";
import type { DbClient } from "@/server/db-client";

/**
 * TESTSCHEMA för demodata och förhandsvisning (aldrig för drift). Skapar pass för innevarande
 * och nästa månad så att det alltid finns både genomförda och kommande pass att titta på.
 * Alla pass hör till testpersoner (isTestData) och är deterministiska för en viss (kategori, index).
 */
const PATTERN: Record<WorkCategory, { step: number; slots: [string, string][] }> = {
  GOLFSHOP: { step: 3, slots: [["09:00", "13:00"], ["13:00", "17:00"], ["10:00", "16:00"]] },
  BOLLPLOCKARE: { step: 4, slots: [["11:00", "15:00"], ["07:00", "11:00"]] },
};

export type DemoShiftPlan = { date: string; from: string; to: string; approval: "APPROVED" | "PENDING" };

/** Rena planen (utan databas): vilka pass en testperson får. `index` sprider personerna över olika dagar. */
export function planDemoShifts(category: WorkCategory, index: number, months: YearMonth[], now: Date): DemoShiftPlan[] {
  const { step, slots } = PATTERN[category];
  const today = stockholmDateOf(now);
  const plan: DemoShiftPlan[] = [];
  for (const { year, month } of months) {
    const days = DateTime.fromObject({ year, month, day: 1 }, { zone: STOCKHOLM_TZ }).daysInMonth ?? 30;
    for (let dom = 1; dom <= days; dom++) {
      if ((dom + index * 2) % step !== 0) continue;
      const [from, to] = slots[(dom + index) % slots.length];
      const date = `${year}-${String(month).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
      plan.push({ date, from, to, approval: date < today || dom % 2 === 1 ? "APPROVED" : "PENDING" });
    }
  }
  return plan;
}

/** Skapar testpass för en anställd om hen inte redan har några. Returnerar antal skapade pass. */
export async function createDemoShifts(
  db: DbClient,
  input: { employeeId: string; category: WorkCategory; createdById: string; index: number; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date();
  if ((await db.shift.count({ where: { assignedEmployeeId: input.employeeId } })) > 0) return 0;

  const current = stockholmYearMonth(now);
  const months = [current, shiftMonth(current, 1)];
  const plan = planDemoShifts(input.category, input.index, months, now);

  const scheduleIds = new Map<string, string>();
  for (const { year, month } of months) {
    const schedule = await db.schedule.upsert({
      where: { category_year_month: { category: input.category, year, month } },
      create: { category: input.category, year, month, status: "PUBLISHED", publishedAt: now },
      update: {},
    });
    scheduleIds.set(`${year}-${month}`, schedule.id);
  }

  const created = await db.shift.createManyAndReturn({
    data: plan.map((p) => {
      const startsAt = localToInstant(p.date, p.from);
      const [year, month] = p.date.split("-").map(Number);
      return {
        scheduleId: scheduleIds.get(`${year}-${month}`)!,
        category: input.category,
        assignedEmployeeId: input.employeeId,
        originalEmployeeId: input.employeeId,
        startsAt,
        endsAt: localToInstant(p.date, p.to),
        localDate: dateStringToDbDate(stockholmDateOf(startsAt)),
        publicationStatus: "PUBLISHED" as const,
        approvalStatus: p.approval,
        createdById: input.createdById,
      };
    }),
    select: { id: true },
  });
  await db.shiftAssignmentHistory.createMany({
    data: created.map((s) => ({
      shiftId: s.id,
      toEmployeeId: input.employeeId,
      reason: "INITIAL" as const,
      changedById: input.createdById,
    })),
  });
  return created.length;
}
