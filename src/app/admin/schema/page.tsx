import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthNav } from "@/components/layout/month-nav";
import { CategoryLegend, ScheduleCalendar } from "@/components/schedule/schedule-calendar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { monthParam, parseMonthParam } from "@/domain/calendar";
import { summarizeShifts } from "@/domain/hours";
import { formatDuration } from "@/domain/money";
import { CATEGORY_LABEL, type WorkCategory } from "@/domain/roles";
import { formatMonthYear, stockholmDateOf, stockholmYearMonth } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getScheduleMonth } from "@/server/queries/schedule";
import { publishShiftsAction } from "./actions";

export const metadata: Metadata = { title: "Schema" };

const CATEGORY_PARAM: Record<string, WorkCategory> = { golfshop: "GOLFSHOP", bollplockare: "BOLLPLOCKARE" };
const FLASH: Record<string, string> = {
  skapat: "Passet skapades.",
  andrat: "Passet ändrades.",
  installt: "Passet ställdes in. Det raderas aldrig och kan återställas.",
  aterstallt: "Passet återställdes.",
};

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ kat?: string; m?: string; sparat?: string; publicerat?: string }>;
}) {
  const session = await requireAdminArea();
  const sp = await searchParams;
  const now = new Date();
  const ym = parseMonthParam(sp.m, now);
  const kat = sp.kat && CATEGORY_PARAM[sp.kat] ? sp.kat : undefined;
  const category = kat ? CATEGORY_PARAM[kat] : null;
  const flash = sp.sparat ? FLASH[sp.sparat] : undefined;
  const publishedCount = sp.publicerat !== undefined && /^\d{1,5}$/.test(sp.publicerat) ? Number(sp.publicerat) : undefined;

  const shifts = await getScheduleMonth(getDb(), toActor(session), { ...ym, category, now });
  const summary = summarizeShifts(
    shifts.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, localDate: s.localDate, workStatus: s.workStatus })),
    now,
  );
  const people = new Set(shifts.map((s) => s.employeeId)).size;

  // Utkast (ej inställda) per grupp i den visade månaden. Personalen ser dem först när de publicerats.
  const drafts = (["GOLFSHOP", "BOLLPLOCKARE"] as const)
    .map((c) => ({ category: c, count: shifts.filter((s) => s.category === c && s.publicationStatus === "DRAFT" && s.workStatus !== "CANCELLED").length }))
    .filter((d) => d.count > 0);

  const current = stockholmYearMonth(now);
  const isCurrent = current.year === ym.year && current.month === ym.month;
  const defaultDate = isCurrent ? stockholmDateOf(now) : `${monthParam(ym)}-01`;
  const katQs = kat ? `&kat=${kat}` : "";

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
        actions={
          <>
            <MonthNav basePath="/admin/schema" params={{ kat }} ym={ym} now={now} />
            <Link href={`/admin/schema/nytt?datum=${defaultDate}${katQs}`} className={buttonVariants({ variant: "primary" })}>
              <Plus className="size-4" aria-hidden />
              Nytt pass
            </Link>
          </>
        }
      />

      {flash ? <Notice tone="success" className="mb-4">{flash}</Notice> : null}
      {publishedCount !== undefined ? (
        <Notice tone={publishedCount > 0 ? "success" : "info"} className="mb-4">
          {publishedCount > 0 ? `${publishedCount} pass publicerades och syns nu för personalen.` : "Det fanns inga utkast att publicera."}
        </Notice>
      ) : null}

      {drafts.length > 0 ? (
        <Card className="mb-6 border-warning-200 bg-warning-50/60">
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-sm font-medium text-warning-700">Utkast som personalen ännu inte ser</p>
            {drafts.map((d) => (
              <form key={d.category} action={publishShiftsAction} className="flex flex-wrap items-center justify-between gap-3">
                <input type="hidden" name="category" value={d.category} />
                <input type="hidden" name="year" value={ym.year} />
                <input type="hidden" name="month" value={ym.month} />
                <span className="text-sm">
                  <b>{CATEGORY_LABEL[d.category]}</b>: {d.count} pass i {formatMonthYear(ym.year, ym.month)} är utkast.
                </span>
                <ConfirmSubmitButton
                  size="sm"
                  confirmText={`Publicera ${d.count} pass i ${CATEGORY_LABEL[d.category]} för ${formatMonthYear(ym.year, ym.month)}? De blir synliga för personalen.`}
                  pendingText="Publicerar…"
                >
                  Publicera {d.count} pass
                </ConfirmSubmitButton>
              </form>
            ))}
          </CardContent>
        </Card>
      ) : null}

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
        shiftHref={(id) => `/admin/schema/pass/${id}`}
        newShiftHref={(date) => `/admin/schema/nytt?datum=${date}${katQs}`}
        shifts={shifts.map((s) => ({
          id: s.id,
          localDate: s.localDate,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          minutes: s.minutes,
          category: s.category,
          employeeName: s.employeeName,
          employeeIsAdmin: s.employeeIsAdmin,
          originalEmployeeName: s.originalEmployeeName,
          phase: s.phase,
          approvalStatus: s.approvalStatus,
          publicationStatus: s.publicationStatus,
          note: s.note,
        }))}
      />

      <Notice tone="info" title="Så fungerar schemat" className="mt-6">
        Klicka på ett pass för att ändra eller ställa in det, eller på + i en dag för att skapa ett nytt. Nya pass är <b>utkast</b> tills du publicerar dem.
        Pass raderas aldrig: ett inställt pass finns kvar i historiken. Kopiera förra veckan eller månaden, och notiser till personalen, byggs senare.
      </Notice>
    </>
  );
}
