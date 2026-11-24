import { CalendarDays, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalBadge } from "@/components/schedule/shift-badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { formatDuration } from "@/domain/money";
import { dateStringToDbDate, formatDateLong, localToInstant, stockholmDateOf, stockholmYearMonth } from "@/domain/time";
import { hhmm } from "./_components/gps-labels";
import { addDaysToDateString } from "@/domain/time";
import { getPanelState } from "@/modules/bollplockare/server/panel";
import { listMyWorkEntries, summarizeByEmployee } from "@/modules/bollplockare/server/reports";
import { getSimulationPoints } from "@/modules/bollplockare/server/simulation";
import { getRangeDay } from "@/modules/bollplockare/server/settings";
import { maybeRunSweeps } from "@/modules/bollplockare/server/sweeps";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { approveShiftAction } from "./actions";
import { ClockPanel } from "./_components/clock-panel";

export const metadata: Metadata = { title: "Start" };

/** Bollplockarens startsida: klocka in/ut överst, sedan dagens och kommande arbetsdagar och månadens timmar. */
export default async function BollplockareHome() {
  const { session, employee } = await requireEmployeeArea("BOLLPLOCKARE");
  const db = getDb();
  const actor = toActor(session);
  const now = new Date();
  await maybeRunSweeps(db, now);

  const today = stockholmDateOf(now);
  const ym = stockholmYearMonth(now);
  const first = `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;
  const [panel, simulation, upcoming, entries] = await Promise.all([
    getPanelState(db, actor, now),
    getSimulationPoints(db),
    db.shift.findMany({
      where: { assignedEmployeeId: employee.id, openEnded: true, publicationStatus: "PUBLISHED", workStatus: { not: "CANCELLED" }, localDate: { gte: dateStringToDbDate(today) } },
      orderBy: { localDate: "asc" },
      take: 6,
    }),
    listMyWorkEntries(db, actor, { from: first, to: addDaysToDateString(first, 31) }),
  ]);
  const days = await Promise.all(upcoming.map((s) => getRangeDay(db, s.localDate.toISOString().slice(0, 10))));
  const mine = summarizeByEmployee(entries)[0];

  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title={`Hej ${panel.firstName}!`} description="Din arbetspanel" />
      <ClockPanel initial={panel} simulation={simulation} />

      <section aria-label="Månadens timmar" className="mt-6 grid grid-cols-2 gap-3">
        <StatCard label="Arbetat denna månad" value={formatDuration(mine?.registeredMinutes ?? 0)} icon={Clock} hint={`${mine?.sessions ?? 0} pass`} />
        <StatCard label="Godkänt av admin" value={formatDuration(mine?.approvedMinutes ?? 0)} hint={mine?.pendingMinutes ? `${formatDuration(mine.pendingMinutes)} väntar` : "Allt granskat"} />
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Kommande arbetsdagar</CardTitle>
          <CardDescription>Du arbetar tills alla bollar är plockade. Incheckning öppnar före rangens stängning.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Inga kommande arbetsdagar" />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((s, i) => {
                const date = s.localDate.toISOString().slice(0, 10);
                const day = days[i];
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
                    <span className="min-w-36 font-medium first-letter:uppercase">{formatDateLong(localToInstant(date, "12:00"))}{date === today ? " (idag)" : ""}</span>
                    <span className="tabular-nums text-ink-muted">{day.closed ? "Rangen stängd" : `Stänger ${day.closeTime?.replace(":", ".")} · in från ${day.earliestCheckIn ? hhmm(day.earliestCheckIn.toISOString()) : "–"}`}</span>
                    <ApprovalBadge status={s.approvalStatus} />
                    {s.approvalStatus === "PENDING" ? (
                      <form action={approveShiftAction} className="ml-auto">
                        <input type="hidden" name="shiftId" value={s.id} />
                        <Button type="submit" size="sm">Godkänn</Button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Link href="/bollplockare/schema" className={buttonVariants({ variant: "secondary", size: "lg" })}>Mitt schema</Link>
        <Link href="/bollplockare/byten" className={buttonVariants({ variant: "secondary", size: "lg" })}>Passbyten</Link>
      </div>
    </div>
  );
}
