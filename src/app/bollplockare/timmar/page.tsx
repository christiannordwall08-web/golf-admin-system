import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { MonthNav } from "@/components/layout/month-nav";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { parseMonthParam } from "@/domain/calendar";
import { formatDuration } from "@/domain/money";
import { addDaysToDateString, formatMonthYear } from "@/domain/time";
import { listMyWorkEntries, summarizeByEmployee } from "@/modules/bollplockare/server/reports";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { hhmm } from "../_components/gps-labels";

export const metadata: Metadata = { title: "Mina timmar" };

/** Mina arbetade timmar: bara de egna, med registrerad och godkänd tid skilda åt. */
export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { session } = await requireEmployeeArea("BOLLPLOCKARE");
  const now = new Date();
  const ym = parseMonthParam((await searchParams).m, now);
  const first = `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;
  const rows = (await listMyWorkEntries(getDb(), toActor(session), { from: first, to: addDaysToDateString(first, 30) })).filter((r) => r.workDate.startsWith(first.slice(0, 7)));
  const sum = summarizeByEmployee(rows)[0];
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Mina timmar" description={formatMonthYear(ym.year, ym.month)} actions={<MonthNav basePath="/bollplockare/timmar" ym={ym} now={now} />} />
      <section aria-label="Sammanfattning" className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Arbetat (registrerat)" value={formatDuration(sum?.registeredMinutes ?? 0)} icon={Clock} hint={`${sum?.sessions ?? 0} pass`} />
        <StatCard label="Godkänt av admin" value={formatDuration(sum?.approvedMinutes ?? 0)} />
        <StatCard label="Väntar på granskning" value={formatDuration(sum?.pendingMinutes ?? 0)} />
      </section>
      {rows.length === 0 ? (
        <Card><EmptyState icon={Clock} title="Inga arbetspass den här månaden" /></Card>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Datum</Th><Th>In</Th><Th>Ut</Th><Th align="right">Paus</Th><Th align="right">Registrerad tid</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entryId}>
                  <Td className="font-medium">{r.workDate}</Td>
                  <Td className="tabular-nums">{r.startedAt ? hhmm(r.startedAt.toISOString()) : "–"}</Td>
                  <Td className="tabular-nums">{r.endedAt ? hhmm(r.endedAt.toISOString()) : "Pågår"}</Td>
                  <Td align="right">{r.pausedMinutes ? `${r.pausedMinutes} min` : "–"}</Td>
                  <Td align="right" className="font-medium">{formatDuration(r.registeredMinutes)}</Td>
                  <Td>
                    {r.open ? <Badge tone="info">Pågår</Badge> : r.approvedMinutes !== null ? <Badge tone="success">{r.corrected ? "Korrigerad och godkänd" : "Godkänd"}</Badge> : <Badge tone="warning">Väntar på granskning</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <p className="mt-4 text-xs text-ink-muted">Registrerad tid är preliminär tills admin har granskat och godkänt den. Du ser bara dina egna timmar.</p>
    </div>
  );
}
