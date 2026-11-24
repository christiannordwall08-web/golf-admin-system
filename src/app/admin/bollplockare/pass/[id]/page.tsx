import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatDuration } from "@/domain/money";
import { formatDateLong, formatDateShort, formatTime, localToInstant } from "@/domain/time";
import { getWorkEntryDetail, statusLabel } from "@/modules/bollplockare/server/reports";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { approveEntryAction } from "../../actions";
import { CorrectionForm } from "../../_components/forms";
import { GpsBadge } from "../../_components/status";

export const metadata: Metadata = { title: "Arbetspass" };

const EVENT_LABEL: Record<string, string> = {
  CLOCK_IN: "Klockade in", CLOCK_OUT: "Klockade ut", PAUSE_STARTED: "Tiden pausades (utanför området)", PAUSE_ENDED: "Tiden återupptogs",
  GPS_UNRELIABLE: "GPS-signal osäker", GPS_MISSING: "GPS-signal saknas", GPS_DENIED: "Platsåtkomst nekad", GPS_RESTORED: "GPS-signal tillbaka",
  CLOCK_OUT_REMINDER: "Påminnelse om utcheckning skickad", ADMIN_CORRECTION: "Admin korrigerade tiden", PAUSE_VOIDED: "Admin rättade en paus",
};

const local = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d).replace(" ", "T");
const person = (u: { name: string | null; email: string } | null | undefined) => (u ? (u.name ?? u.email) : "–");

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminArea();
  const detail = await getWorkEntryDetail(getDb(), toActor(session), (await params).id).catch((e) => {
    if (e instanceof NotFoundError) return null;
    throw e;
  });
  if (!detail) notFound();
  const { entry: e, row } = detail;
  const s = e.bollplockareSession;
  const ended = Boolean(e.registeredEndsAt);
  const approved = e.status === "APPROVED" || e.status === "CORRECTED";
  const pauses = s?.pauses ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link href="/admin/bollplockare" className="text-sm text-brand-700 hover:underline">← Bollplockare</Link>
      <PageHeader
        title={`${row.employeeName} · ${formatDateLong(localToInstant(row.workDate, "12:00"))}`}
        description={`Rangen stängde ${row.closeTime?.replace(":", ".") ?? "–"} · ${statusLabel(e.status)}`}
        actions={!ended ? <Badge tone="info">Pågår</Badge> : approved ? <Badge tone="success">{statusLabel(e.status)}</Badge> : row.needsReview ? <Badge tone="warning">Kräver granskning</Badge> : <Badge tone="neutral">Preliminär</Badge>}
      />

      <Card className="mb-6">
        <CardContent className="grid gap-3 p-5 text-sm sm:grid-cols-3">
          <p><span className="text-ink-muted">Incheckning</span><br /><b className="text-base tabular-nums">{e.registeredStartsAt ? formatTime(e.registeredStartsAt) : "–"}</b></p>
          <p><span className="text-ink-muted">Utcheckning</span><br /><b className="text-base tabular-nums">{e.registeredEndsAt ? formatTime(e.registeredEndsAt) : "Pågår"}</b></p>
          <p><span className="text-ink-muted">Total tid</span><br /><b className="text-base">{row.totalMinutes !== null ? formatDuration(row.totalMinutes) : "–"}</b></p>
          <p><span className="text-ink-muted">Registrerade pauser</span><br /><b className="text-base">{row.pausedMinutes} min ({row.pauseCount})</b></p>
          <p><span className="text-ink-muted">Registrerad arbetstid</span><br /><b className="text-base">{formatDuration(e.registeredMinutes)}</b></p>
          <p><span className="text-ink-muted">Godkänd tid</span><br /><b className="text-base">{e.approvedMinutes !== null ? formatDuration(e.approvedMinutes) : "Ej godkänd"}</b>{e.approvedBy ? <span className="block text-xs text-ink-muted">av {person(e.approvedBy)}</span> : null}</p>
          {s?.reviewReasons.length && !approved ? <p className="sm:col-span-3"><span className="text-ink-muted">Därför granskas passet:</span> {s.reviewReasons.join(", ")}</p> : null}
          {!ended && s ? <p className="sm:col-span-3"><span className="text-ink-muted">GPS just nu:</span> <GpsBadge status={s.gpsStatus === "NONE" ? "NONE" : s.gpsStatus} /> {s.lastPositionAt ? <span className="text-ink-muted">senast verifierad {formatTime(s.lastPositionAt)}</span> : null}</p> : null}
        </CardContent>
      </Card>

      {ended && !approved ? (
        <Card className="mb-6 border-brand-200">
          <CardHeader><CardTitle>Godkänn eller korrigera</CardTitle><CardDescription>Bara godkänd tid ger ersättning. En paus är ingen automatisk avdragsgrund: du kan rätta den.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-6">
            <form action={approveEntryAction}>
              <input type="hidden" name="id" value={e.id} />
              <Button type="submit" size="lg">Godkänn registrerad tid ({formatDuration(e.registeredMinutes)})</Button>
            </form>
            <div className="border-t border-line pt-5">
              <p className="mb-3 text-sm font-semibold">Eller korrigera</p>
              <CorrectionForm
                entryId={e.id}
                version={e.version}
                startedAt={local(e.registeredStartsAt!)}
                endedAt={local(e.registeredEndsAt!)}
                pausedMinutes={row.pausedMinutes}
                pauses={pauses.map((p) => ({ id: p.id, voided: p.voidedAt !== null, label: `${formatTime(p.startedAt)}–${p.endedAt ? formatTime(p.endedAt) : "pågår"}${p.distanceM ? `, ${Math.round(p.distanceM)} m utanför gränsen` : ""}` }))}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
      {ended && approved ? <Notice tone="success" className="mb-6">Tiden är {statusLabel(e.status).toLowerCase()}. Ändringar görs i den låsta/avstämda rapporten.</Notice> : null}

      <Card className="mb-6">
        <CardHeader><CardTitle>Pauser (geografiska avvikelser)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {pauses.length === 0 ? <EmptyState title="Inga pauser" /> : (
            <TableWrap className="rounded-none border-0 shadow-none">
              <Table>
                <thead><tr><Th>Start</Th><Th>Slut</Th><Th align="right">Längd</Th><Th align="right">Avstånd från gräns</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {pauses.map((p) => (
                    <tr key={p.id}>
                      <Td className="tabular-nums">{formatTime(p.startedAt)}</Td><Td className="tabular-nums">{p.endedAt ? formatTime(p.endedAt) : "Pågår"}</Td>
                      <Td align="right">{p.endedAt ? `${Math.round((p.endedAt.getTime() - p.startedAt.getTime()) / 60_000)} min` : "–"}</Td>
                      <Td align="right">{p.distanceM ? `${Math.round(p.distanceM)} m` : "–"}</Td>
                      <Td>{p.voidedAt ? <span><Badge tone="neutral">Rättad</Badge> <span className="text-xs text-ink-muted">{person(p.voidedBy)}: {p.voidReason}</span></span> : p.endedBy === "RETURNED" ? "Återvände" : p.endedBy === "CLOCKED_OUT" ? "Klockade ut" : "Pågår"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>Historik för passet</CardTitle><CardDescription>Händelser i tidsordning. Innehåller aldrig koordinater.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-line">
            {(s?.events ?? []).map((ev) => (
              <li key={ev.id} className="flex flex-wrap gap-x-3 px-5 py-2 text-sm">
                <span className="w-14 tabular-nums text-ink-muted">{formatTime(ev.at)}</span><span>{EVENT_LABEL[ev.type] ?? ev.type}</span>
                {ev.data && typeof ev.data === "object" && "distanceM" in ev.data ? <span className="text-ink-muted">({String((ev.data as { distanceM: number }).distanceM)} m från gränsen)</span> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ändringshistorik (korrigeringar)</CardTitle><CardDescription>Ursprungligt värde, nytt värde, anledning, vem och när. Kan aldrig ändras eller raderas.</CardDescription></CardHeader>
        <CardContent className="p-0">
          {e.corrections.length === 0 ? <EmptyState title="Inga korrigeringar" /> : (
            <ul className="divide-y divide-line">
              {e.corrections.map((c) => {
                const d = c.detail as { registeredMinutes?: number[]; startedAt?: string[]; endedAt?: string[]; pausedMinutes?: number[] } | null;
                return (
                  <li key={c.id} className="px-5 py-3 text-sm">
                    <p className="text-xs text-ink-muted">{person(c.correctedBy)} · {formatDateShort(c.createdAt)} {formatTime(c.createdAt)}</p>
                    <p>Registrerad tid: <b>{d?.registeredMinutes?.[0] ?? "–"} min → {d?.registeredMinutes?.[1] ?? c.newApprovedMinutes} min</b>{d?.startedAt ? ` · in ${formatTime(new Date(d.startedAt[0]))} → ${formatTime(new Date(d.startedAt[1]))}` : ""}{d?.endedAt ? ` · ut ${formatTime(new Date(d.endedAt[0]))} → ${formatTime(new Date(d.endedAt[1]))}` : ""}{d?.pausedMinutes ? ` · paus ${d.pausedMinutes[0]} → ${d.pausedMinutes[1]} min` : ""}</p>
                    <p className="text-ink-muted">Anledning: {c.reason}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
