import { CalendarDays, CircleDollarSign, Clock, Hourglass, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { MonthNav } from "@/components/layout/month-nav";
import { ApprovalBadge, PhaseBadge } from "@/components/schedule/shift-badges";
import { ScheduleCalendar } from "@/components/schedule/schedule-calendar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { parseMonthParam } from "@/domain/calendar";
import { formatDuration, formatSek } from "@/domain/money";
import { CATEGORY_HOME, CATEGORY_LABEL, type WorkCategory } from "@/domain/roles";
import { formatDateLong, formatMonthYear, formatTimeRange, localToInstant } from "@/domain/time";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { type MyMonth, getMyMonth } from "@/server/queries/self";

type SP = Promise<{ m?: string }>;

async function load(category: WorkCategory, searchParams: SP) {
  // Sidan kontrollerar själv inloggningstyp och anställning (en layout körs inte vid varje klientnavigering).
  const { session, employee } = await requireEmployeeArea(category);
  const now = new Date();
  const ym = parseMonthParam((await searchParams).m, now);
  const my = await getMyMonth(getDb(), toActor(session), { userId: session.user.id, employeeId: employee.id, ...ym, now });
  return { my, ym, now };
}

const dayLabel = (d: Date) => formatDateLong(d);

function ShiftTable({ my }: { my: MyMonth }) {
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr><Th>Datum</Th><Th>Tid</Th><Th align="right">Timmar</Th><Th>Godkännande</Th><Th>Status</Th></tr>
        </thead>
        <tbody>
          {my.shifts.map((s) => (
            <tr key={s.id}>
              <Td className="first-letter:uppercase">{dayLabel(localToInstant(s.localDate, "12:00"))}</Td>
              <Td className="tabular-nums">{formatTimeRange(s.startsAt, s.endsAt)}</Td>
              <Td align="right">{formatDuration(s.minutes)}</Td>
              <Td><ApprovalBadge status={s.approvalStatus} /></Td>
              <Td>{s.phase === "UPCOMING" ? <span className="text-ink-muted">Kommande</span> : <PhaseBadge phase={s.phase} />}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

/** Startsida: nästa pass, mina timmar, väntande godkännanden. Bara personens egna uppgifter. */
export async function EmployeeHome({ category, searchParams }: { category: WorkCategory; searchParams: SP }) {
  const { my, ym } = await load(category, searchParams);
  const home = CATEGORY_HOME[category];
  const upcoming = my.shifts.filter((s) => s.phase === "UPCOMING" || s.phase === "ONGOING").slice(0, 6);

  return (
    <>
      <PageHeader title={`Hej ${my.firstName}!`} description={`Din personliga panel · ${CATEGORY_LABEL[category]} · ${formatMonthYear(ym.year, ym.month)}`} />

      <section aria-label="Översikt" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5 sm:col-span-2">
          <p className="text-sm text-ink-muted">Nästa pass</p>
          {my.next ? (
            <>
              <p className="mt-2 text-2xl font-semibold tracking-tight first-letter:uppercase">{dayLabel(localToInstant(my.next.localDate, "12:00"))}</p>
              <p className="mt-1 text-lg tabular-nums">{formatTimeRange(my.next.startsAt, my.next.endsAt)} <span className="text-ink-muted">· {formatDuration(my.next.minutes)}</span></p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <ApprovalBadge status={my.next.approvalStatus} />
                {my.next.phase === "ONGOING" ? <PhaseBadge phase="ONGOING" /> : null}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Du har inga kommande pass just nu.</p>
          )}
        </Card>
        <StatCard label="Genomfört i månaden" value={formatDuration(my.summary.completedMinutes)} icon={Clock} hint={`${my.summary.completedCount} pass · enligt schema`} />
        <StatCard label="Kommande i månaden" value={formatDuration(my.summary.remainingMinutes)} icon={Hourglass} hint={`${my.summary.remainingCount} pass`} />
        <StatCard label="Väntar på mitt godkännande" value={my.pendingApprovals} icon={ShieldCheck} hint="Att acceptera pass byggs i Etapp 3" />
        {my.estimatedCompensationOre !== null ? (
          <StatCard label="Min preliminära ersättning" value={formatSek(my.estimatedCompensationOre)} icon={CircleDollarSign} hint="Bara din egen, genomförda pass, ej godkänd" />
        ) : null}
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Mina kommande pass</CardTitle>
          <CardDescription>Resten av månaden.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Inga fler pass den här månaden" />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                  <span className="min-w-40 font-medium first-letter:uppercase">{dayLabel(localToInstant(s.localDate, "12:00"))}</span>
                  <span className="tabular-nums">{formatTimeRange(s.startsAt, s.endsAt)}</span>
                  <ApprovalBadge status={s.approvalStatus} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={`${home}/schema`} className={buttonVariants({ variant: "primary" })}>Mitt schema</Link>
        <Link href={`${home}/timmar`} className={buttonVariants({ variant: "secondary" })}>Mina timmar</Link>
      </div>
    </>
  );
}

/** Mitt schema: bara mina egna pass, månad för månad. */
export async function EmployeeSchedule({ category, searchParams }: { category: WorkCategory; searchParams: SP }) {
  const { my, ym, now } = await load(category, searchParams);
  const home = CATEGORY_HOME[category];
  return (
    <>
      <PageHeader title="Mitt schema" description={`${CATEGORY_LABEL[category]} · ${formatMonthYear(ym.year, ym.month)}`} actions={<MonthNav basePath={`${home}/schema`} ym={ym} now={now} />} />
      <ScheduleCalendar
        ym={ym}
        now={now}
        emptyText="Du har inga pass den här månaden."
        shifts={my.shifts.map((s) => ({
          id: s.id,
          localDate: s.localDate,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          minutes: s.minutes,
          category,
          phase: s.phase,
          approvalStatus: s.approvalStatus,
        }))}
      />
      <Notice tone="info" className="mt-6">
        Du kan inte flytta pass själv. Att acceptera pass och begära ändring eller passbyte (som Admin godkänner) byggs i Etapp 3.
      </Notice>
    </>
  );
}

/** Mina timmar: genomförda och kommande pass med summor. Aldrig andras timmar eller löner. */
export async function EmployeeHours({ category, searchParams }: { category: WorkCategory; searchParams: SP }) {
  const { my, ym, now } = await load(category, searchParams);
  const home = CATEGORY_HOME[category];
  return (
    <>
      <PageHeader title="Mina timmar" description={`${CATEGORY_LABEL[category]} · ${formatMonthYear(ym.year, ym.month)}`} actions={<MonthNav basePath={`${home}/timmar`} ym={ym} now={now} />} />
      <section aria-label="Sammanfattning" className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Genomfört (enligt schema)" value={formatDuration(my.summary.completedMinutes)} icon={Clock} hint="Preliminärt, ej godkänd tid" />
        <StatCard label="Kommande" value={formatDuration(my.summary.remainingMinutes)} icon={Hourglass} />
        <StatCard label="Totalt i månaden" value={formatDuration(my.summary.totalMinutes)} icon={CalendarDays} />
      </section>
      {my.estimatedCompensationOre !== null ? (
        <Notice tone="success" title={`Min preliminära ersättning: ${formatSek(my.estimatedCompensationOre)}`} className="mb-6">
          Gäller bara dina egna genomförda pass och är inte godkänd. Du ser aldrig andras timmar eller löner.
        </Notice>
      ) : null}
      {my.shifts.length === 0 ? (
        <Card><EmptyState icon={CalendarDays} title="Inga pass den här månaden" /></Card>
      ) : (
        <ShiftTable my={my} />
      )}
      <p className="mt-4 text-xs text-ink-muted">Kontrollerat {formatDateLong(now)}. Godkända timmar och korrigeringar från Admin visas här när de byggs (Etapp 4).</p>
    </>
  );
}
