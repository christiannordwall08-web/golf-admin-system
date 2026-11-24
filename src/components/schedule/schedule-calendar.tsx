import Link from "next/link";
import { type YearMonth, WEEKDAYS_SHORT, buildMonthGrid } from "@/domain/calendar";
import { CATEGORY_LABEL, type WorkCategory } from "@/domain/roles";
import { formatDateLong, formatTimeRange, localToInstant } from "@/domain/time";
import { formatDuration } from "@/domain/money";
import { cn } from "@/lib/utils";
import { DayDropZone } from "./planner";
import { AdminTag, ApprovalBadge, CategoryBadge, DraftBadge, PhaseBadge } from "./shift-badges";
import type { ShiftPhase } from "@/domain/hours";

export type CalendarShift = {
  id: string;
  localDate: string;
  startsAt: Date;
  endsAt: Date;
  minutes: number;
  category: WorkCategory;
  /** Namn på ansvarig person. Utelämnas i personalens egna vyer (där är det alltid jag). */
  employeeName?: string;
  /** Den ansvariga är administratör (visas som liten markering). */
  employeeIsAdmin?: boolean;
  originalEmployeeName?: string | null;
  phase: ShiftPhase;
  approvalStatus: "PENDING" | "APPROVED" | "CHANGE_REQUESTED" | "APPROVED_AFTER_SWAP";
  publicationStatus?: "DRAFT" | "PUBLISHED";
  /** Pass utan fast sluttid (bollplockare): visar "in från HH.mm" i stället för ett tidsintervall. */
  openEnded?: boolean;
  /** Notering från schemat, t.ex. "öppnar". */
  note?: string | null;
};

const CHIP: Record<WorkCategory, string> = {
  GOLFSHOP: "bg-brand-100 text-brand-900 border-brand-200",
  BOLLPLOCKARE: "bg-info-50 text-info-700 border-info-200",
};

function group(shifts: CalendarShift[]): Map<string, CalendarShift[]> {
  const map = new Map<string, CalendarShift[]>();
  for (const s of shifts) map.set(s.localDate, [...(map.get(s.localDate) ?? []), s]);
  return map;
}

/**
 * Månadsschema. Stor skärm: kalenderrutnät där varje pass visar NAMN + tid. Liten skärm: dagslista.
 * Namn och tid hör alltid ihop, och flera personer samma dag visas alla.
 */
export function ScheduleCalendar({
  ym,
  now,
  shifts,
  showCategory = false,
  emptyText = "Inga pass den här månaden.",
  shiftHref,
  newShiftHref,
  plannable = false,
}: {
  ym: YearMonth;
  now: Date;
  shifts: CalendarShift[];
  showCategory?: boolean;
  emptyText?: string;
  /** Gör varje pass till en länk (Admin: ändra pass). */
  shiftHref?: (shiftId: string) => string;
  /** Visar en "+"-länk i varje dag (Admin: nytt pass den dagen). */
  newShiftHref?: (date: string) => string;
  /** Dagarna tar emot namn som dras dit (kräver att sidan ligger inom PlannerProvider). */
  plannable?: boolean;
}) {
  const byDate = group(shifts);
  const weeks = buildMonthGrid(ym, now);
  const dates = [...byDate.keys()].sort();

  return (
    <>
      {/* Rutnät (surfplatta/dator) */}
      <div className="hidden overflow-hidden rounded-card border border-line bg-white shadow-card md:block">
        <div className="grid grid-cols-7 border-b border-line bg-stone-50/70">
          {WEEKDAYS_SHORT.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-line last:border-b-0">
            {week.map((day) => {
              const dayShifts = byDate.get(day.date) ?? [];
              const cellClass = cn(
                "min-h-28 border-r border-line p-1.5 last:border-r-0",
                !day.inMonth && "bg-stone-50/60 text-ink-muted/60",
                day.isWeekend && day.inMonth && "bg-stone-50/30",
              );
              const Cell = plannable && day.inMonth ? DayDropZone : "div";
              const cellProps = plannable && day.inMonth ? { date: day.date, className: cellClass } : { className: cellClass };
              return (
                <Cell key={day.date} {...(cellProps as { date: string; className: string })}>
                  <div className="mb-1 flex items-center justify-between">
                    {newShiftHref && day.inMonth ? (
                      <Link
                        href={newShiftHref(day.date)}
                        aria-label={`Nytt pass ${day.date}`}
                        title="Nytt pass"
                        className="flex size-6 items-center justify-center rounded-full text-base leading-none text-ink-muted/60 hover:bg-brand-100 hover:text-brand-800"
                      >
                        +
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs",
                        day.isToday ? "bg-brand-700 font-semibold text-white" : "text-ink-muted",
                      )}
                    >
                      {day.day}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {day.inMonth
                      ? dayShifts.map((s) => {
                          const inner = (
                            <>
                              {s.employeeName ? (
                                <span className="block truncate font-semibold">
                                  {s.employeeName}
                                  {s.employeeIsAdmin ? <span className="ml-1 text-[9px] font-medium tracking-wide uppercase opacity-70">admin</span> : null}
                                </span>
                              ) : null}
                              <span className="block tabular-nums">{s.openEnded ? `in från ${formatTimeRange(s.startsAt, s.endsAt).split("–")[0]}` : formatTimeRange(s.startsAt, s.endsAt)}</span>
                              {s.note ? <span className="block text-[10px] font-medium italic">{s.note}</span> : null}
                              {s.publicationStatus === "DRAFT" ? <span className="block text-[9px] font-semibold tracking-wide uppercase opacity-70">utkast</span> : null}
                            </>
                          );
                          return (
                            <li
                              key={s.id}
                              title={`${s.employeeName ?? ""} ${s.openEnded ? "in från " + formatTimeRange(s.startsAt, s.endsAt).split("–")[0] : formatTimeRange(s.startsAt, s.endsAt)}`.trim()}
                              className={cn(
                                "rounded-md border text-[11px] leading-tight",
                                CHIP[s.category],
                                s.publicationStatus === "DRAFT" && "border-dashed",
                                (s.phase === "CANCELLED" || s.phase === "ABSENT") && "line-through opacity-60",
                                s.phase === "COMPLETED" && "opacity-75",
                              )}
                            >
                              {shiftHref ? (
                                <Link href={shiftHref(s.id)} className="block rounded-md px-1.5 py-1 hover:bg-white/50">
                                  {inner}
                                </Link>
                              ) : (
                                <div className="px-1.5 py-1">{inner}</div>
                              )}
                            </li>
                          );
                        })
                      : null}
                  </ul>
                </Cell>
              );
            })}
          </div>
        ))}
      </div>

      {/* Dagslista (mobil) – visas också som komplement på stor skärm */}
      <div className="mt-6 md:mt-8">
        <h2 className="mb-3 text-base font-semibold">Pass per dag</h2>
        {dates.length === 0 ? (
          <p className="rounded-card border border-line bg-white p-6 text-center text-sm text-ink-muted shadow-card">{emptyText}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {dates.map((date) => (
              <li key={date} className="overflow-hidden rounded-card border border-line bg-white shadow-card">
                <h3 className="border-b border-line bg-stone-50/70 px-4 py-2 text-sm font-semibold first-letter:uppercase">
                  {formatDateLong(localToInstant(date, "12:00"))}
                </h3>
                <ul className="divide-y divide-line">
                  {byDate.get(date)!.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                      {s.employeeName ? <span className="font-medium">{s.employeeName}</span> : null}
                      {s.employeeIsAdmin ? <AdminTag /> : null}
                      <span className="tabular-nums">{s.openEnded ? `in från ${formatTimeRange(s.startsAt, s.endsAt).split("–")[0]} (ingen fast sluttid)` : formatTimeRange(s.startsAt, s.endsAt)}</span>
                      {s.openEnded ? null : <span className="text-ink-muted">{formatDuration(s.minutes)}</span>}
                      {s.note ? <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium italic">{s.note}</span> : null}
                      {showCategory ? <CategoryBadge category={s.category} /> : null}
                      <span className="flex flex-wrap gap-1.5">
                        {s.publicationStatus ? <DraftBadge publicationStatus={s.publicationStatus} /> : null}
                        <ApprovalBadge status={s.approvalStatus} />
                        {s.phase !== "UPCOMING" ? <PhaseBadge phase={s.phase} /> : null}
                      </span>
                      {s.originalEmployeeName ? (
                        <span className="text-xs text-ink-muted">Ursprungligen {s.originalEmployeeName}</span>
                      ) : null}
                      {shiftHref ? (
                        <Link href={shiftHref(s.id)} className="ml-auto text-sm font-medium text-brand-700 hover:underline">
                          Ändra
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

/** Teckenförklaring för kategorifärgerna. */
export function CategoryLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-xs text-ink-muted" aria-label="Färgförklaring">
      {(["GOLFSHOP", "BOLLPLOCKARE"] as const).map((c) => (
        <li key={c} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded border", CHIP[c])} aria-hidden />
          {CATEGORY_LABEL[c]}
        </li>
      ))}
    </ul>
  );
}
