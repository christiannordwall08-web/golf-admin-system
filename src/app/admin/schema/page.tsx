import type { Metadata } from "next";
import Link from "next/link";
import { MonthNav } from "@/components/layout/month-nav";
import { CategoryLegend, ScheduleCalendar } from "@/components/schedule/schedule-calendar";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { monthParam, parseMonthParam } from "@/domain/calendar";
import { summarizeShifts } from "@/domain/hours";
import { formatDuration } from "@/domain/money";
import type { WorkCategory } from "@/domain/roles";
import { formatMonthYear } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getScheduleMonth } from "@/server/queries/schedule";

export const metadata: Metadata = { title: "Schema" };

const CATEGORY_PARAM: Record<string, WorkCategory> = { golfshop: "GOLFSHOP", bollplockare: "BOLLPLOCKARE" };

export default async function AdminSchedulePage({ searchParams }: { searchParams: Promise<{ kat?: string; m?: string }> }) {
  const session = await requireAdminArea();
  const sp = await searchParams;
  const now = new Date();
  const ym = parseMonthParam(sp.m, now);
  const kat = sp.kat && CATEGORY_PARAM[sp.kat] ? sp.kat : undefined;
  const category = kat ? CATEGORY_PARAM[kat] : null;

  const shifts = await getScheduleMonth(getDb(), toActor(session), { ...ym, category, now });
  const summary = summarizeShifts(
    shifts.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, localDate: s.localDate, workStatus: s.workStatus })),
    now,
  );
  const people = new Set(shifts.map((s) => s.employeeId)).size;

  const tab = (key: string | undefined, label: string) => {
    const qs = new URLSearchParams();
    if (key) qs.set("kat", key);
    qs.set("m", monthParam(ym));
    const active = kat === key;
    return (
      <Link
        key={label}
        href={`/admin/schema?${qs}`}
        aria-current={active ? "page" : undefined}
        className={active ? "rounded-full bg-brand-700 px-3.5 py-1.5 text-sm font-medium text-white" : "rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-brand-50"}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Schema"
        description={`${category ? (category === "GOLFSHOP" ? "Schema A · Golfshop" : "Schema B · Bollplockare") : "Samlat schema · Golfshop och Bollplockare"} · ${formatMonthYear(ym.year, ym.month)}`}
        actions={<MonthNav basePath="/admin/schema" params={{ kat }} ym={ym} now={now} />}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="navigation" aria-label="Välj schema">
          {tab(undefined, "Samlat")}
          {tab("golfshop", "Golfshop")}
          {tab("bollplockare", "Bollplockare")}
        </div>
        <CategoryLegend />
      </div>

      <section aria-label="Sammanfattning" className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Pass" value={shifts.length} hint={`${people} personer`} />
        <StatCard label="Genomfört (enligt schema)" value={formatDuration(summary.completedMinutes)} />
        <StatCard label="Kommande" value={formatDuration(summary.remainingMinutes)} />
      </section>

      <ScheduleCalendar
        ym={ym}
        now={now}
        showCategory={!category}
        shifts={shifts.map((s) => ({
          id: s.id,
          localDate: s.localDate,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          minutes: s.minutes,
          category: s.category,
          employeeName: s.employeeName,
          originalEmployeeName: s.originalEmployeeName,
          phase: s.phase,
          approvalStatus: s.approvalStatus,
          publicationStatus: s.publicationStatus,
          note: s.note,
        }))}
      />

      <Notice tone="info" title="Bara visning just nu" className="mt-6">
        Här ser du hela schemat för båda grupperna, med den ansvariga personens namn vid varje pass. Att skapa, ändra och publicera pass byggs i nästa steg.
      </Notice>
    </>
  );
}
