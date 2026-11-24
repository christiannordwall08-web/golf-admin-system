import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthNav } from "@/components/layout/month-nav";
import { ApprovalBadge } from "@/components/schedule/shift-badges";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { parseMonthParam } from "@/domain/calendar";
import { formatDuration } from "@/domain/money";
import { dateStringToDbDate, dbDateToString, formatDateLong, formatMonthYear, localToInstant, monthBounds, stockholmDateOf } from "@/domain/time";
import { addDaysToDateString } from "@/domain/time";
import { listMyWorkEntries } from "@/modules/bollplockare/server/reports";
import { getRangeDay } from "@/modules/bollplockare/server/settings";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { approveShiftAction } from "../actions";
import { hhmm } from "../_components/gps-labels";

export const metadata: Metadata = { title: "Mitt schema" };

/** Mitt schema: datum, veckodag, rangens stängningstid och tidigaste incheckning. Inga fasta sluttider. */
export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { session, employee } = await requireEmployeeArea("BOLLPLOCKARE");
  const db = getDb();
  const now = new Date();
  const today = stockholmDateOf(now);
  const ym = parseMonthParam((await searchParams).m, now);
  const { start, end } = monthBounds(ym.year, ym.month);
  const first = `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;
  const shifts = await db.shift.findMany({
    where: { assignedEmployeeId: employee.id, openEnded: true, publicationStatus: "PUBLISHED", startsAt: { gte: start, lt: end } },
    orderBy: { localDate: "asc" },
  });
  const entries = await listMyWorkEntries(db, toActor(session), { from: first, to: addDaysToDateString(first, 31) });
  const byDate = new Map(entries.map((e) => [e.workDate, e]));
  const days = await Promise.all(shifts.map((s) => getRangeDay(db, dbDateToString(s.localDate))));
  void dateStringToDbDate;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title="Mitt schema" description={formatMonthYear(ym.year, ym.month)} actions={<MonthNav basePath="/bollplockare/schema" ym={ym} now={now} />} />
      {shifts.some((s) => s.approvalStatus === "PENDING" && dbDateToString(s.localDate) >= today) ? (
        <Notice tone="warning" title="Du har pass att godkänna" className="mb-4">Godkänn passen nedan så vet admin att du kan jobba.</Notice>
      ) : null}
      <Card>
        <CardContent className="p-0">
          {shifts.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Inga arbetsdagar den här månaden" />
          ) : (
            <ul className="divide-y divide-line">
              {shifts.map((s, i) => {
                const date = dbDateToString(s.localDate);
                const day = days[i];
                const done = byDate.get(date);
                const future = date >= today && s.workStatus !== "CANCELLED" && !done;
                return (
                  <li key={s.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold first-letter:uppercase">{formatDateLong(localToInstant(date, "12:00"))}</span>
                      {date === today ? <Badge tone="brand">Idag</Badge> : null}
                      {s.workStatus === "CANCELLED" ? <Badge tone="danger">Inställt</Badge> : <ApprovalBadge status={s.approvalStatus} />}
                      {day.closed ? <Badge tone="danger">Rangen stängd</Badge> : null}
                    </div>
                    <p className="text-ink-muted">
                      {day.closed ? "Rangen är stängd den här dagen." : <>Rangen stänger <b className="text-ink">{day.closeTime?.replace(":", ".")}</b> · tidigaste incheckning <b className="text-ink">{day.earliestCheckIn ? hhmm(day.earliestCheckIn.toISOString()) : "–"}</b>{day.isOverride ? " (avvikande tid)" : ""}</>}
                    </p>
                    {done ? (
                      <p className="text-ink-muted">Arbetat {done.startedAt ? hhmm(done.startedAt.toISOString()) : "–"}–{done.endedAt ? hhmm(done.endedAt.toISOString()) : "pågår"} · <b className="text-ink">{formatDuration(done.registeredMinutes)}</b>{done.pausedMinutes ? ` (paus ${done.pausedMinutes} min)` : ""} · {done.approvedMinutes !== null ? "godkänt av admin" : "väntar på granskning"}</p>
                    ) : null}
                    {future ? (
                      <div className="flex flex-wrap gap-2">
                        {s.approvalStatus === "PENDING" ? (
                          <form action={approveShiftAction}><input type="hidden" name="shiftId" value={s.id} /><Button type="submit" size="sm">Godkänn passet</Button></form>
                        ) : null}
                        <Link href={`/bollplockare/byten/ny?pass=${s.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Byt pass / begär ändring</Link>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Notice tone="info" className="mt-4">Bollplockare arbetar tills alla bollar är plockade, så passen har ingen fast sluttid. Tiden registreras när du klockar in och ut.</Notice>
    </div>
  );
}
