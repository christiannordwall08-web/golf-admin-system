import { CalendarX, CheckCircle2, Folder, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { MonthNav } from "@/components/layout/month-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { monthParam, parseMonthParam } from "@/domain/calendar";
import { formatSek } from "@/domain/money";
import { formatDateLong, formatDateShort, formatMonthYear, formatTime, localToInstant } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getClosingsMonth } from "@/server/services/daily-closing";
import { markReviewedAction } from "./actions";

export const metadata: Metadata = { title: "Dagsavslut" };

export default async function AdminClosingsPage({ searchParams }: { searchParams: Promise<{ m?: string; datum?: string }> }) {
  const session = await requireAdminArea();
  const sp = await searchParams;
  const now = new Date();
  // Kommer man från en notis (?datum=…) visas den dagens månad.
  const focus = sp.datum && /^\d{4}-\d{2}-\d{2}$/.test(sp.datum) ? sp.datum : undefined;
  const ym = parseMonthParam(sp.m ?? focus?.slice(0, 7), now);
  const month = await getClosingsMonth(getDb(), toActor(session), { ...ym, now });
  const latest = month.days[0];

  return (
    <>
      <PageHeader
        title="Dagsavslut"
        description={`Bilder och dagens summa som personalen skickat in · ${formatMonthYear(ym.year, ym.month)}`}
        actions={<MonthNav basePath="/admin/dagsavslut" ym={ym} now={now} />}
      />

      <section aria-label="Sammanfattning" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Senaste dagens summa"
          value={latest ? formatSek(latest.dayTotalOre) : "–"}
          icon={Wallet}
          hint={latest ? `${formatDateLong(localToInstant(latest.date, "12:00"))}${latest.closings.length > 1 ? ` · ${latest.closings.length} inskickade` : ""}` : "Inget inskickat i månaden"}
        />
        <StatCard label="Månadens summa" value={formatSek(month.monthTotalOre)} icon={Wallet} hint={`${month.days.length} dagar med avslut`} />
        <StatCard label="Ej granskade" value={month.newCount} icon={CheckCircle2} hint="Markera som granskade när du tittat" />
        <StatCard label="Dagar utan avslut" value={month.missingDates.length} icon={CalendarX} hint="Passerade dagar med pass i golfshopen" />
      </section>

      {month.missingDates.length > 0 ? (
        <Notice tone="warning" title="Dagsavslut saknas" className="mt-6">
          Inget dagsavslut har skickats in för: {month.missingDates.slice(-10).map((d) => formatDateShort(localToInstant(d, "12:00"))).join(", ")}
          {month.missingDates.length > 10 ? ` (och ${month.missingDates.length - 10} tidigare dagar)` : ""}.
        </Notice>
      ) : null}

      <div className="mt-6 flex flex-col gap-5">
        {month.days.length === 0 ? (
          <Card><EmptyState icon={Folder} title="Inga dagsavslut den här månaden">När personalen skickar in ett avslut hamnar det här, en mapp per dag.</EmptyState></Card>
        ) : (
          month.days.map((day) => (
            <Card key={day.date} className={`overflow-hidden ${focus === day.date ? "border-brand-400 ring-2 ring-brand-200" : ""}`}>
              <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-stone-50/70 px-5 py-3 text-sm font-semibold">
                <Folder className="size-4 text-brand-700" aria-hidden />
                <span className="first-letter:uppercase">{formatDateLong(localToInstant(day.date, "12:00"))}</span>
                <span className="font-normal text-ink-muted">{day.date.replaceAll("-", "/")}</span>
                <span className="ml-auto tabular-nums">Dagens summa: {formatSek(day.dayTotalOre)}</span>
              </h2>
              <ul className="divide-y divide-line">
                {day.closings.map((c, i) => (
                  <li key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row">
                    <a href={`/api/dagsavslut/${c.id}/bild`} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label="Öppna bilden i full storlek">
                      {/* eslint-disable-next-line @next/next/no-img-element -- skyddad bild från vår egen inloggade route */}
                      <img src={`/api/dagsavslut/${c.id}/bild`} alt={`Dagsavslut ${day.date} från ${c.employeeName}`} loading="lazy" className="h-40 w-full rounded-lg border border-line bg-stone-100 object-cover sm:w-56" />
                    </a>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold">{c.employeeName}</p>
                      <p className="text-ink-muted">Inskickat {formatDateShort(c.uploadedAt)} kl. {formatTime(c.uploadedAt)}</p>
                      <p className="mt-1 tabular-nums">Summa: <b>{formatSek(c.dayTotalOre)}</b>{i > 0 ? <span className="ml-2 text-ink-muted">(tidigare inskickat)</span> : null}</p>
                      {c.note ? <p className="mt-1 italic text-ink-muted">”{c.note}”</p> : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {c.status === "REVIEWED" ? (
                          <Badge tone="success">Granskat av {c.reviewedByName}{c.reviewedAt ? ` ${formatDateShort(c.reviewedAt)}` : ""}</Badge>
                        ) : (
                          <form action={markReviewedAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <Button type="submit" size="sm" variant="secondary">Markera som granskat</Button>
                          </form>
                        )}
                        <a href={`/api/dagsavslut/${c.id}/bild`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-700 hover:underline">Öppna bild</a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))
        )}
      </div>

      <p className="mt-6 text-xs text-ink-muted">Dagens summa är den senast inskickade för dagen. Bilderna ligger i skyddad lagring (mappen .storage/dagsavslut/år/månad/dag) och visas bara för administratörer. Månad: {monthParam(ym)}.</p>
    </>
  );
}
