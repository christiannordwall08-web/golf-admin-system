import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthNav } from "@/components/layout/month-nav";
import { ApprovalBadge, CategoryBadge, PhaseBadge } from "@/components/schedule/shift-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { monthParam, parseMonthParam } from "@/domain/calendar";
import { formatDuration, formatSek } from "@/domain/money";
import { CATEGORY_LABEL } from "@/domain/roles";
import { formatDateLong, formatMonthYear, formatTimeRange, localToInstant } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { getEmployeeProfile } from "@/server/queries/profile";

export const metadata: Metadata = { title: "Personalprofil" };

export default async function EmployeeProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await requireAdminArea();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const now = new Date();
  const ym = parseMonthParam(sp.m, now);

  let p;
  try {
    p = await getEmployeeProfile(getDb(), toActor(session), id, { ...ym, now });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  return (
    <>
      <Link href={`/admin/personal?m=${monthParam(ym)}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Personal &amp; löner
      </Link>
      <PageHeader
        title={`${p.firstName} ${p.lastName}`.trim()}
        description={`${CATEGORY_LABEL[p.category]} · ${formatMonthYear(ym.year, ym.month)}`}
        actions={<MonthNav basePath={`/admin/personal/${p.employeeId}`} ym={ym} now={now} />}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <CategoryBadge category={p.category} />
        {p.isAdmin ? <Badge tone="neutral">Administratör</Badge> : null}
        <Badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status === "ACTIVE" ? "Aktiv" : "Inaktiv"}</Badge>
        {p.otherEmploymentCategories.map((c) => (
          <Badge key={c} tone="neutral">Även anställd: {CATEGORY_LABEL[c]}</Badge>
        ))}
      </div>

      <section aria-label="Sammanfattning" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Timlön idag" value={p.currentHourlyRateOre === null ? (p.hourlyPaid ? "Saknas" : p.fixedSalary ? "Fast lön" : "Ej timlön") : `${formatSek(p.currentHourlyRateOre)}/h`} hint={!p.hourlyPaid ? "Ingår inte i timlön" : undefined} />
        <StatCard label="Genomfört i månaden" value={formatDuration(p.summary.completedMinutes)} hint={`${p.summary.completedCount} pass · enligt schema`} />
        <StatCard label="Kommande i månaden" value={formatDuration(p.summary.remainingMinutes)} hint={`${p.summary.remainingCount} pass`} />
        <StatCard label="Preliminär ersättning" value={!p.hourlyPaid && p.currentHourlyRateOre === null ? "–" : formatSek(p.estimatedCompensationOre)} hint={!p.hourlyPaid && p.currentHourlyRateOre === null ? "Ingår inte i timlön" : p.shiftsMissingRate > 0 ? `Timlön saknas för ${p.shiftsMissingRate} genomförda pass` : "Genomförda pass, ej godkänd"} />
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Lönehistorik</CardTitle><CardDescription>Ändrad lön påverkar aldrig redan arbetade pass.</CardDescription></CardHeader>
            <CardContent>
              {p.rateHistory.length === 0 ? (
                <p className="text-sm text-ink-muted">Ingen timlön är satt.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {[...p.rateHistory].reverse().map((r) => (
                    <li key={r.id} className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{formatSek(r.hourlyRateOre)}/h</span>
                      <span className="text-ink-muted tabular-nums">{r.validFrom} → {r.validTo ?? "tills vidare"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Kontaktuppgifter</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-ink-muted">E-post</dt><dd>{p.email ?? "–"}</dd>
                <dt className="text-ink-muted">Telefon</dt><dd>{p.phone ?? "–"}</dd>
                <dt className="text-ink-muted">Anställd sedan</dt><dd>{p.employmentStartDate ?? "–"}</dd>
              </dl>
            </CardContent>
          </Card>
      </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Pass i {formatMonthYear(ym.year, ym.month)}</CardTitle>
            <CardDescription>Varje pass med timlön och preliminär ersättning (bara genomförda pass).</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {p.shifts.length === 0 ? (
              <EmptyState title="Inga pass den här månaden" />
            ) : (
              <TableWrap className="rounded-none border-0 shadow-none">
                <Table>
                  <thead>
                    <tr><Th>Datum</Th><Th>Tid</Th><Th align="right">Timmar</Th><Th>Notering</Th><Th align="right">Timlön</Th><Th align="right">Prel. ersättning</Th><Th>Status</Th></tr>
                  </thead>
                  <tbody>
                    {p.shifts.map((s) => (
                      <tr key={s.id}>
                        <Td className="first-letter:uppercase">{formatDateLong(localToInstant(s.localDate, "12:00"))}</Td>
                        <Td className="tabular-nums">{formatTimeRange(s.startsAt, s.endsAt)}</Td>
                        <Td align="right">{formatDuration(s.minutes)}</Td>
                        <Td className="italic text-ink-muted">{s.note ?? ""}</Td>
                        <Td align="right">{s.hourlyRateOre === null ? "–" : formatSek(s.hourlyRateOre)}</Td>
                        <Td align="right">{s.estimatedCompensationOre === null ? "–" : formatSek(s.estimatedCompensationOre)}</Td>
                        <Td><span className="flex flex-wrap gap-1"><ApprovalBadge status={s.approvalStatus} />{s.phase !== "UPCOMING" ? <PhaseBadge phase={s.phase} /> : null}</span></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>
    </>
  );
}
