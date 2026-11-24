import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthNav } from "@/components/layout/month-nav";
import { CategoryBadge } from "@/components/schedule/shift-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { monthParam, parseMonthParam } from "@/domain/calendar";
import { formatDuration, formatSek } from "@/domain/money";
import type { WorkCategory } from "@/domain/roles";
import { formatDateShort, formatMonthYear, formatTimeRange } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getPersonnelOverview } from "@/server/queries/personnel";

export const metadata: Metadata = { title: "Personal & löner" };

const CATEGORY_PARAM: Record<string, WorkCategory | null> = { golfshop: "GOLFSHOP", bollplockare: "BOLLPLOCKARE" };

export default async function PersonnelPage({ searchParams }: { searchParams: Promise<{ q?: string; kat?: string; m?: string }> }) {
  const session = await requireAdminArea();
  const sp = await searchParams;
  const now = new Date();
  const ym = parseMonthParam(sp.m, now);
  const category = sp.kat ? (CATEGORY_PARAM[sp.kat] ?? null) : null;
  const q = (sp.q ?? "").slice(0, 60);

  const { rows, totals } = await getPersonnelOverview(getDb(), toActor(session), { ...ym, category, search: q, now });
  const filters = { q: q || undefined, kat: sp.kat && CATEGORY_PARAM[sp.kat] ? sp.kat : undefined };
  const tab = (key: string | undefined, label: string) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (key) qs.set("kat", key);
    qs.set("m", monthParam(ym));
    const active = (filters.kat ?? undefined) === key;
    return (
      <Link
        key={label}
        href={`/admin/personal?${qs}`}
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
        title="Personal & löner"
        description={`Alla anställda med timlön, arbetade och kommande timmar · ${formatMonthYear(ym.year, ym.month)}`}
        actions={<MonthNav basePath="/admin/personal" params={filters} ym={ym} now={now} />}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="navigation" aria-label="Arbetskategori">
          {tab(undefined, "Alla")}
          {tab("golfshop", "Golfshop")}
          {tab("bollplockare", "Bollplockare")}
        </div>
        <form method="get" className="flex gap-2" role="search">
          {filters.kat ? <input type="hidden" name="kat" value={filters.kat} /> : null}
          <input type="hidden" name="m" value={monthParam(ym)} />
          <Input name="q" defaultValue={q} placeholder="Sök på namn" aria-label="Sök på namn" className="w-full sm:w-64" />
          <Button type="submit" variant="secondary"><Search className="size-4" aria-hidden />Sök</Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Card><EmptyState title="Inga anställda hittades">Ändra sökningen eller filtret.</EmptyState></Card>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Namn</Th><Th>Kategori</Th><Th align="right">Timlön</Th>
                <Th align="right">Genomfört</Th><Th align="right">Kommande</Th><Th align="right">Totalt</Th>
                <Th align="right">Prel. ersättning</Th><Th>Nästa pass</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="hover:bg-brand-50/40">
                  <Td className="font-medium whitespace-nowrap">
                    <Link href={`/admin/personal/${r.employeeId}?m=${monthParam(ym)}`} className="text-brand-800 hover:underline">{r.fullName}</Link>
                  </Td>
                  <Td><CategoryBadge category={r.category} /></Td>
                  <Td align="right">{r.hourlyRateOre === null ? <span className="text-danger-700">Saknas</span> : `${formatSek(r.hourlyRateOre)}/h`}</Td>
                  <Td align="right">{formatDuration(r.completedMinutes)}</Td>
                  <Td align="right">{formatDuration(r.remainingMinutes)}</Td>
                  <Td align="right" className="font-medium">{formatDuration(r.totalMinutes)}</Td>
                  <Td align="right">{formatSek(r.estimatedCompensationOre)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {r.nextShift ? `${formatDateShort(r.nextShift.startsAt)} ${formatTimeRange(r.nextShift.startsAt, r.nextShift.endsAt)}` : <span className="text-ink-muted">Inget planerat</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-stone-50/70 font-semibold">
                <Td>Totalt ({totals.employees} anställda)</Td><Td />
                <Td align="right" />
                <Td align="right">{formatDuration(totals.completedMinutes)}</Td>
                <Td align="right">{formatDuration(totals.remainingMinutes)}</Td>
                <Td align="right">{formatDuration(totals.totalMinutes)}</Td>
                <Td align="right">{formatSek(totals.estimatedCompensationOre)}</Td><Td />
              </tr>
            </tfoot>
          </Table>
        </TableWrap>
      )}

      <Notice tone="info" title="Så läses tabellen" className="mt-6">
        <b>Genomfört</b> = pass vars sluttid passerat, <b>Kommande</b> = återstående schemalagt i månaden (inkl. pågående).
        Det är tid enligt schema, inte godkänd arbetstid. <b>Prel. ersättning</b> räknas bara på genomförda pass med lönen som gällde
        respektive dag. Godkännande och löneunderlag byggs i Etapp 4.
      </Notice>
    </>
  );
}
