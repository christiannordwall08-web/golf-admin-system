import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthNav } from "@/components/layout/month-nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { monthParam, parseMonthParam, shiftMonth } from "@/domain/calendar";
import { formatDuration, formatSek } from "@/domain/money";
import type { WorkCategory } from "@/domain/roles";
import { addDaysToDateString, formatMonthYear, formatTime } from "@/domain/time";
import { listWorkEntries, statusLabel, summarizeByEmployee } from "@/modules/bollplockare/server/reports";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Arbetstid och rapporter" };

const STATUS_KEYS = ["ALL", "NEEDS_REVIEW", "PRELIMINARY", "APPROVED"] as const;
const STATUS_LABEL = { ALL: "Alla", NEEDS_REVIEW: "Kräver granskning", PRELIMINARY: "Ej godkända", APPROVED: "Godkända" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string; status?: string; anstalld?: string; kat?: string; vecka?: string }> }) {
  const session = await requireAdminArea();
  const sp = await searchParams;
  const now = new Date();
  const ym = parseMonthParam(sp.m, now);
  const status = (STATUS_KEYS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUS_KEYS)[number]) : "ALL";
  const category: WorkCategory | null = sp.kat === "bollplockare" ? "BOLLPLOCKARE" : null;
  const first = `${monthParam(ym)}-01`;
  const last = addDaysToDateString(`${monthParam(shiftMonth(ym, 1))}-01`, -1);
  const employeeId = sp.anstalld && /^[a-z0-9]{10,40}$/i.test(sp.anstalld) ? sp.anstalld : undefined;
  const rows = await listWorkEntries(getDb(), toActor(session), { from: first, to: last, status, employeeId, category });
  const summary = summarizeByEmployee(rows);
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ m: monthParam(ym), status, ...(category ? { kat: "bollplockare" } : {}), ...(employeeId ? { anstalld: employeeId } : {}), ...over });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return p.toString();
  };
  const exportHref = `/admin/rapporter/export?${qs({})}`;

  return (
    <>
      <PageHeader
        title="Arbetstid och rapporter"
        description={`Registrerad och godkänd arbetstid · ${formatMonthYear(ym.year, ym.month)}`}
        actions={<><MonthNav basePath="/admin/rapporter" params={{ status, ...(category ? { kat: "bollplockare" } : {}) }} ym={ym} now={now} /><a href={exportHref} className={buttonVariants({ variant: "primary" })}><Download className="size-4" aria-hidden /> Exportera CSV</a></>}
      />
      <div className="mb-4 flex flex-wrap gap-2" role="navigation" aria-label="Filter">
        {STATUS_KEYS.map((k) => (
          <Link key={k} href={`/admin/rapporter?${qs({ status: k })}`} aria-current={status === k ? "page" : undefined} className={status === k ? "rounded-full bg-brand-700 px-3.5 py-1.5 text-sm font-medium text-white" : "rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-brand-50"}>{STATUS_LABEL[k]}</Link>
        ))}
        <Link href={`/admin/rapporter?${qs({ kat: category ? undefined : "bollplockare" })}`} className="ml-auto rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-brand-50">{category ? "Visa alla grupper" : "Bara bollplockare"}</Link>
      </div>

      {summary.length > 0 ? (
        <Card className="mb-6 overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-base font-semibold">Månadens sammanställning per person</h2>
          <TableWrap className="rounded-none border-0 shadow-none">
            <Table>
              <thead><tr><Th>Anställd</Th><Th align="right">Pass</Th><Th align="right">Registrerat</Th><Th align="right">Godkänt</Th><Th align="right">Väntar</Th><Th align="right">Granskning</Th><Th align="right">Ersättning (godkänd tid)</Th></tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.employeeId}>
                    <Td className="font-medium"><Link href={`/admin/rapporter?${qs({ anstalld: s.employeeId })}`} className="text-brand-800 hover:underline">{s.employeeName}</Link></Td>
                    <Td align="right">{s.sessions}</Td><Td align="right">{formatDuration(s.registeredMinutes)}</Td><Td align="right">{formatDuration(s.approvedMinutes)}</Td>
                    <Td align="right">{formatDuration(s.pendingMinutes)}</Td><Td align="right">{s.needsReview || "–"}</Td><Td align="right">{s.compensationOre ? formatSek(s.compensationOre) : "–"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><EmptyState title="Inga registreringar">Det finns inga arbetspass med de här filtren. Bollplockarnas tid registreras när de klockar ut.</EmptyState></Card>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Anställd</Th><Th>Datum</Th><Th>Kategori</Th><Th>Stängning</Th><Th>In</Th><Th>Ut</Th><Th align="right">Total</Th><Th align="right">Paus</Th><Th align="right">Registrerad</Th><Th align="right">Godkänd</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entryId}>
                  <Td className="font-medium">{r.employeeName}</Td><Td className="tabular-nums">{r.workDate}</Td><Td>{r.category === "BOLLPLOCKARE" ? "Bollplockare" : "Golfshop"}</Td>
                  <Td className="tabular-nums">{r.closeTime?.replace(":", ".") ?? "–"}</Td>
                  <Td className="tabular-nums">{r.startedAt ? formatTime(r.startedAt) : "–"}</Td><Td className="tabular-nums">{r.endedAt ? formatTime(r.endedAt) : "Pågår"}</Td>
                  <Td align="right">{r.totalMinutes !== null ? formatDuration(r.totalMinutes) : "–"}</Td><Td align="right">{r.pausedMinutes ? `${r.pausedMinutes} min` : "–"}</Td>
                  <Td align="right" className="font-medium">{formatDuration(r.registeredMinutes)}</Td><Td align="right">{r.approvedMinutes !== null ? formatDuration(r.approvedMinutes) : "–"}</Td>
                  <Td>{r.open ? <Badge tone="info">Pågår</Badge> : r.needsReview ? <Badge tone="warning">Kräver granskning</Badge> : <Badge tone={r.approvedMinutes !== null ? "success" : "neutral"}>{statusLabel(r.status)}</Badge>}{r.corrected ? <Badge tone="neutral" className="ml-1">Korrigerad</Badge> : null}</Td>
                  <Td><Link href={`/admin/bollplockare/pass/${r.entryId}`} className="text-brand-700 hover:underline">Granska</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Notice tone="info" title="Så läses rapporten" className="mt-6">Registrerad tid kommer från bollplockarnas incheckning och utcheckning minus pauser. Den är preliminär tills du godkänner eller korrigerar den. Varje korrigering sparas med ursprungsvärde, nytt värde, anledning, vem och när. Golfshops tid registreras från schemat och byggs ut separat.</Notice>
    </>
  );
}
