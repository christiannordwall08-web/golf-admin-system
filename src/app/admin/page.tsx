import { AlarmClock, CalendarClock, CircleDollarSign, Clock, FileEdit, Hourglass, ShieldCheck, Users, Repeat, UserCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminTag, ApprovalBadge, CategoryBadge, PhaseBadge } from "@/components/schedule/shift-badges";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatDuration, formatSek } from "@/domain/money";
import { formatDateShort, formatMonthYear, formatTimeRange, stockholmDateOf } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getAdminDashboard } from "@/server/queries/dashboard";
import { getClosingForDate } from "@/server/services/daily-closing";

export const metadata: Metadata = { title: "Översikt" };

export default async function AdminHome() {
  // Samma kontroll som layouten: en sida ska aldrig förlita sig på att en layout körts.
  const session = await requireAdminArea();
  const now = new Date();
  const [d, closingToday] = await Promise.all([
    getAdminDashboard(getDb(), toActor(session), now),
    getClosingForDate(getDb(), toActor(session), stockholmDateOf(now)),
  ]);
  const ongoing = d.today.filter((s) => s.phase === "ONGOING").length;
  const todayPeople = new Set(d.today.map((s) => s.employeeId)).size;

  return (
    <>
      <PageHeader
        title={`Hej ${session.user.firstName ?? "Admin"}`}
        description={`Översikt över personal, timmar och schema · ${formatMonthYear(d.year, d.month)}`}
        actions={
          <>
            <Link href="/admin/personal" className={buttonVariants({ variant: "secondary" })}>Personal &amp; löner</Link>
            <Link href="/admin/schema" className={buttonVariants({ variant: "primary" })}>Se scheman</Link>
          </>
        }
      />

      <section aria-label="Nyckeltal" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Anställda (aktiva)" value={d.employees.total} icon={Users} hint={`Golfshop ${d.employees.golfshop} · Bollplockare ${d.employees.bollplockare} · Admin ${d.employees.admins}`} />
        <StatCard label="Schemalagda idag" value={todayPeople} icon={CalendarClock} hint={`${d.today.length} pass`} />
        <StatCard label="Pågår just nu (enligt schema)" value={ongoing} icon={AlarmClock} hint="Schemabaserat, inte verifierad incheckning" />
        <StatCard label="Genomfört i månaden" value={formatDuration(d.monthTotals.completedMinutes)} icon={Clock} hint="Timanställda · enligt schema, ej godkänd" />
        <StatCard label="Kommande i månaden" value={formatDuration(d.monthTotals.remainingMinutes)} icon={Hourglass} hint="Timanställda · schemalagt, inte genomfört" />
        <StatCard label="Godkända timmar" value={formatDuration(d.approvedMinutes)} icon={UserCheck} hint="Godkännande byggs i Etapp 4" />
        <StatCard label="Preliminär lönekostnad" value={formatSek(d.monthTotals.estimatedCompensationOre)} icon={CircleDollarSign} hint={d.monthTotals.shiftsMissingRate > 0 ? `${d.monthTotals.shiftsMissingRate} genomförda pass saknar timlön och ingår inte` : "Genomförda pass × timlön, ej godkänd"} />
        <StatCard label="Väntar på godkännande" value={d.actions.pendingApprovals} icon={ShieldCheck} hint="Pass som personalen inte accepterat än" />
        <StatCard label="Bytesförfrågningar" value={d.actions.openSwapRequests} icon={Repeat} hint="Öppna ärenden" />
        <StatCard
          label="Dagens summa (dagsavslut)"
          value={closingToday ? formatSek(closingToday.dayTotalOre) : "–"}
          icon={Wallet}
          hint={closingToday ? `Inskickat idag (${closingToday.count} st). Se Dagsavslut.` : "Inget dagsavslut inskickat idag än"}
        />
        <StatCard label="Utkast (ej publicerade pass)" value={d.actions.draftShifts} icon={FileEdit} hint="Framtida pass" />
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Personal som arbetar idag</CardTitle>
          <CardDescription>Namn, tid och status för varje pass idag. Statusen följer schemat och är ingen verifierad incheckning.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {d.today.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Ingen är schemalagd idag" />
          ) : (
            <TableWrap className="rounded-none border-0 shadow-none">
              <Table>
                <thead>
                  <tr><Th>Anställd</Th><Th>Arbetskategori</Th><Th>Datum</Th><Th>Schemalagd tid</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {d.today.map((s) => (
                    <tr key={s.id}>
                      <Td className="font-medium"><span className="inline-flex items-center gap-2">{s.employeeName}{s.employeeIsAdmin ? <AdminTag /> : null}</span></Td>
                      <Td><CategoryBadge category={s.category} /></Td>
                      <Td>{formatDateShort(s.startsAt)}</Td>
                      <Td className="tabular-nums">{formatTimeRange(s.startsAt, s.endsAt)}</Td>
                      <Td><PhaseBadge phase={s.phase} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Kommande arbetspass</CardTitle>
          <CardDescription>De närmaste passen i båda grupperna.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {d.upcoming.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Inga kommande pass" />
          ) : (
            <TableWrap className="rounded-none border-0 shadow-none">
              <Table>
                <thead>
                  <tr><Th>Anställd</Th><Th>Arbetskategori</Th><Th>Datum</Th><Th>Tid</Th><Th>Godkännande</Th></tr>
                </thead>
                <tbody>
                  {d.upcoming.map((s) => (
                    <tr key={s.id}>
                      <Td className="font-medium"><span className="inline-flex items-center gap-2">{s.employeeName}{s.employeeIsAdmin ? <AdminTag /> : null}</span></Td>
                      <Td><CategoryBadge category={s.category} /></Td>
                      <Td>{formatDateShort(s.startsAt)}</Td>
                      <Td className="tabular-nums">{formatTimeRange(s.startsAt, s.endsAt)}</Td>
                      <Td><ApprovalBadge status={s.approvalStatus} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Notice tone="info" title="Timmar och lön just nu" className="mt-6">
        Siffrorna bygger på schemat. Godkänd arbetstid, korrigeringar, månadsrapporter och löneunderlag byggs i Etapp 4.
        Framtida pass räknas aldrig som genomförda.
      </Notice>
    </>
  );
}
