import { CalendarDays, Clock, Hourglass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthNav } from "@/components/layout/month-nav";
import { ApprovalBadge, CategoryBadge } from "@/components/schedule/shift-badges";
import { CategoryLegend, ScheduleCalendar } from "@/components/schedule/schedule-calendar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { parseMonthParam } from "@/domain/calendar";
import { formatDuration } from "@/domain/money";
import { CATEGORY_HOME, CATEGORY_LABEL } from "@/domain/roles";
import { formatDateLong, formatMonthYear, formatTimeRange, localToInstant } from "@/domain/time";
import { requireCombinedEmployeeArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getMyMonth } from "@/server/queries/self";

export const metadata: Metadata = { title: "Alla mina pass" };

/** Startsida för den som jobbar på båda ställena: alla egna pass samlade, med arbetsplats på varje pass. */
export default async function CombinedHomePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const session = await requireCombinedEmployeeArea();
  const now = new Date();
  const ym = parseMonthParam((await searchParams).m, now);
  const months = await Promise.all(
    session.user.employments.map((e) =>
      getMyMonth(getDb(), toActor(session), { userId: session.user.id, employeeId: e.id, ...ym, now }),
    ),
  );
  const all = months.flatMap((m) => m.shifts.map((s) => ({ ...s, category: m.category }))).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const next = months.flatMap((m) => (m.next ? [{ ...m.next, category: m.category }] : [])).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  const sum = (pick: (m: (typeof months)[number]) => number) => months.reduce((n, m) => n + pick(m), 0);

  return (
    <>
      <PageHeader
        title={`Hej ${months[0].firstName}!`}
        description={`Alla dina pass · Golfshop och Bollplockare · ${formatMonthYear(ym.year, ym.month)}`}
        actions={<MonthNav basePath="/anstalld" ym={ym} now={now} />}
      />

      <section aria-label="Översikt" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5 sm:col-span-2">
          <p className="text-sm text-ink-muted">Nästa pass</p>
          {next ? (
            <>
              <p className="mt-2 text-2xl font-semibold tracking-tight first-letter:uppercase">{formatDateLong(localToInstant(next.localDate, "12:00"))}</p>
              <p className="mt-1 text-lg tabular-nums">
                {formatTimeRange(next.startsAt, next.endsAt)} <span className="text-ink-muted">· {formatDuration(next.minutes)}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <CategoryBadge category={next.category} />
                <ApprovalBadge status={next.approvalStatus} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Du har inga kommande pass just nu.</p>
          )}
        </Card>
        <StatCard label="Genomfört i månaden" value={formatDuration(sum((m) => m.summary.completedMinutes))} icon={Clock} hint="Båda ställena · enligt schema" />
        <StatCard label="Kommande i månaden" value={formatDuration(sum((m) => m.summary.remainingMinutes))} icon={Hourglass} hint="Båda ställena" />
      </section>

      <section aria-label="Arbetsplatser" className="mt-6 grid gap-4 sm:grid-cols-2">
        {months.map((m) => (
          <Card key={m.category} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <CategoryBadge category={m.category} />
              <p className="mt-2 text-sm text-ink-muted">
                {formatDuration(m.summary.completedMinutes)} genomfört · {formatDuration(m.summary.remainingMinutes)} kvar
              </p>
            </div>
            <Link href={CATEGORY_HOME[m.category]} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Öppna {CATEGORY_LABEL[m.category]}
            </Link>
          </Card>
        ))}
      </section>

      <div className="mt-8 mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarDays className="size-4" aria-hidden /> Alla mina pass
        </h2>
        <CategoryLegend />
      </div>
      <ScheduleCalendar
        ym={ym}
        now={now}
        showCategory
        emptyText="Du har inga pass den här månaden."
        shifts={all.map((s) => ({
          id: s.id,
          localDate: s.localDate,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          minutes: s.minutes,
          category: s.category,
          phase: s.phase,
          approvalStatus: s.approvalStatus,
          note: s.note,
        }))}
      />
    </>
  );
}
