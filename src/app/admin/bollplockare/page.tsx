import { AlarmClock, CircleCheck, Hourglass, MapPinOff, PauseCircle, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { LiveMap, type LiveMarker } from "@/components/map/live-map";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatDuration } from "@/domain/money";
import { formatDateLong, formatMonthYear, formatTime, localToInstant } from "@/domain/time";
import { ageText, formatHms, GPS_LABEL } from "@/app/bollplockare/_components/gps-labels";
import { getBollplockareLive } from "@/modules/bollplockare/server/live";
import { maybeRunSweeps } from "@/modules/bollplockare/server/sweeps";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { GpsBadge, StateBadge } from "./_components/status";

export const metadata: Metadata = { title: "Bollplockare" };

/** Admins realtidsöversikt: vem ska arbeta, vem arbetar, vem är pausad, GPS-läge, karta, avvikelser och månadens timmar. */
export default async function Page() {
  const session = await requireAdminArea();
  const db = getDb();
  const now = new Date();
  await maybeRunSweeps(db, now);
  const live = await getBollplockareLive(db, toActor(session), now);
  const p = live.people;
  const working = p.filter((x) => x.state === "ACTIVE");
  const paused = p.filter((x) => x.state === "PAUSED");
  const gpsIssues = [...working, ...paused].filter((x) => ["UNRELIABLE", "MISSING", "DENIED", "STALE", "VERIFYING"].includes(x.gps));
  const waiting = p.filter((x) => x.state === "SCHEDULED" || x.state === "AWAITING_CHECK_IN");
  const done = p.filter((x) => ["COMPLETED", "NEEDS_REVIEW", "APPROVED"].includes(x.state));

  const markers: LiveMarker[] = p.flatMap((x) =>
    x.position && x.entryId
      ? [{
          id: x.employeeId,
          name: x.name,
          tone: x.state === "PAUSED" ? ("red" as const) : x.gps === "VERIFYING" ? ("yellow" as const) : ["UNRELIABLE", "MISSING", "DENIED", "STALE"].includes(x.gps) ? ("orange" as const) : ("green" as const),
          lat: x.position.lat,
          lng: x.position.lng,
          stale: x.position.stale,
          href: `/admin/bollplockare/pass/${x.entryId}`,
          lines: [
            `Status: ${x.state === "PAUSED" ? "Arbetstid pausad" : "Arbetar"}`,
            `Incheckad: ${x.startedAt ? formatTime(x.startedAt) : "–"}`,
            `Arbetstid: ${formatHms(x.workedSeconds ?? 0)}`,
            `GPS: ${GPS_LABEL[x.gps].label}${x.distanceM ? ` (${Math.round(x.distanceM)} m utanför gränsen)` : ""}`,
            `Paus: ${x.pausedMinutes} min${x.pauseOpenSince ? ` (pågår sedan ${formatTime(x.pauseOpenSince)})` : ""}`,
            x.position.stale ? `Senast verifierad position: ${x.lastPositionAt ? formatTime(x.lastPositionAt) : "–"} (GAMMAL, inte aktuell)` : `Senaste positionsuppdatering: ${x.lastPositionAt ? formatTime(x.lastPositionAt) : "–"}`,
          ],
        }]
      : [],
  );

  return (
    <>
      <AutoRefresh seconds={15} />
      <PageHeader
        title="Bollplockare"
        description={`Realtidsöversikt · uppdateras var 15:e sekund · ${formatDateLong(localToInstant(live.today, "12:00"))}`}
        actions={
          <>
            <Link href="/admin/bollplockare/planering" className={buttonVariants({ variant: "secondary" })}>Planera dagar</Link>
            <Link href="/admin/rapporter?kat=bollplockare" className={buttonVariants({ variant: "primary" })}>Arbetstid & rapporter</Link>
          </>
        }
      />

      {!live.area.configured ? (
        <Notice tone="warning" title="Arbetsområdet är inte inställt" className="mb-4">
          Bollplockare kan inte klocka in förrän golfanläggningens område är ritat. <Link href="/admin/bollplockare/omrade" className="font-medium underline">Rita området på kartan</Link>.
        </Notice>
      ) : null}

      <section aria-label="Läget just nu" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Arbetar nu" value={working.length} icon={Users} hint="Incheckade och aktiva" />
        <StatCard label="Pausade" value={paused.length} icon={PauseCircle} hint="Utanför området (bekräftat)" />
        <StatCard label="GPS osäker/saknas" value={gpsIssues.length} icon={MapPinOff} hint="Påverkar inte arbetstiden" />
        <StatCard label="Ej incheckade" value={waiting.length} icon={Hourglass} hint="Schemalagda idag" />
        <StatCard label="Klara idag" value={done.length} icon={CircleCheck} />
      </section>

      <Card className="mt-6">
        <CardHeader><CardTitle>Bollplockare idag</CardTitle><CardDescription>Namn, arbetstid och GPS-läge. En position äldre än {Math.round(live.settings.staleAfterSeconds / 60 * 10) / 10} min visas som gammal.</CardDescription></CardHeader>
        <CardContent className="p-0">
          {p.length === 0 ? (
            <EmptyState icon={AlarmClock} title="Ingen bollplockare är schemalagd idag">Lägg in dagar under <Link href="/admin/bollplockare/planering" className="underline">Planera dagar</Link>.</EmptyState>
          ) : (
            <TableWrap className="rounded-none border-0 shadow-none">
              <Table>
                <thead><tr><Th>Anställd</Th><Th>Rangen stänger</Th><Th>Status</Th><Th>Incheckad</Th><Th align="right">Arbetstid</Th><Th>GPS</Th><Th>Senast verifierad</Th><Th /></tr></thead>
                <tbody>
                  {p.map((x) => (
                    <tr key={x.shiftId}>
                      <Td className="font-medium">{x.name}</Td>
                      <Td className="tabular-nums">{x.closeTime?.replace(":", ".") ?? "Stängt"}{x.earliestCheckIn ? <span className="text-ink-muted"> (in {formatTime(x.earliestCheckIn)})</span> : null}</Td>
                      <Td><StateBadge state={x.state} />{!x.published ? <Badge tone="neutral" className="ml-1">Utkast</Badge> : null}</Td>
                      <Td className="tabular-nums">{x.startedAt ? formatTime(x.startedAt) : "–"}{x.endedAt ? `–${formatTime(x.endedAt)}` : ""}</Td>
                      <Td align="right" className="tabular-nums">{x.workedSeconds !== null ? formatHms(x.workedSeconds) : x.registeredMinutes !== null ? formatDuration(x.registeredMinutes) : "–"}{x.pausedMinutes ? <span className="block text-xs text-ink-muted">paus {x.pausedMinutes} min</span> : null}</Td>
                      <Td>{x.state === "ACTIVE" || x.state === "PAUSED" ? <GpsBadge status={x.gps} /> : <span className="text-ink-muted">–</span>}</Td>
                      <Td className="tabular-nums text-ink-muted">{x.lastPositionAt && (x.state === "ACTIVE" || x.state === "PAUSED") ? `${formatTime(x.lastPositionAt)} (${ageText((now.getTime() - x.lastPositionAt.getTime()) / 1000)})` : "–"}</Td>
                      <Td>{x.entryId ? <Link href={`/admin/bollplockare/pass/${x.entryId}`} className="text-brand-700 hover:underline">Öppna</Link> : null}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle>Karta</CardTitle><CardDescription>Arbetsområdet (grönt), säkerhetsmarginalen {live.area.marginMeters} m (streckad gul) och pågående bollplockare. Positioner visas bara under ett pågående pass.</CardDescription></CardHeader>
        <CardContent>
          {live.area.configured ? <LiveMap rings={live.area.rings} marginMeters={live.area.marginMeters} markers={markers} /> : <EmptyState title="Ingen karta än">Rita arbetsområdet först.</EmptyState>}
          {live.area.configured && markers.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Ingen bollplockare är incheckad just nu.</p> : null}
          <p className="mt-2 text-xs text-ink-muted">Kartdata © OpenStreetMap-bidragsgivare. Ljus markering med streckad kant = gammal position (inte aktuell).</p>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Senaste geografiska avvikelser</CardTitle><CardDescription>Pauser de senaste 7 dagarna. Admin kan granska och rätta varje paus.</CardDescription></CardHeader>
          <CardContent className="p-0">
            {live.deviations.length === 0 ? <EmptyState title="Inga avvikelser" /> : (
              <ul className="divide-y divide-line">
                {live.deviations.map((d) => (
                  <li key={d.pauseId} className="px-5 py-3 text-sm">
                    <Link href={`/admin/bollplockare/pass/${d.entryId}`} className="font-medium text-brand-800 hover:underline">{d.name}</Link>
                    <span className="text-ink-muted"> · {formatTime(d.startedAt)}–{d.endedAt ? formatTime(d.endedAt) : "pågår"}{d.distanceM ? ` · ${Math.round(d.distanceM)} m utanför gränsen` : ""}</span>
                    {d.voided ? <Badge tone="neutral" className="ml-2">Rättad av admin</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Kommande arbetsdagar</CardTitle><CardDescription>Nästa 14 dagarna.</CardDescription></CardHeader>
          <CardContent className="p-0">
            {live.upcoming.length === 0 ? <EmptyState title="Inga kommande dagar" /> : (
              <ul className="divide-y divide-line">
                {live.upcoming.map((u) => (
                  <li key={u.shiftId} className="flex flex-wrap items-center gap-x-3 px-5 py-2.5 text-sm">
                    <span className="min-w-28 font-medium">{u.date}</span><span>{u.name}</span>
                    <span className="text-ink-muted">stänger {u.closeTime?.replace(":", ".") ?? "–"}</span>
                    {!u.published ? <Badge tone="neutral">Utkast</Badge> : u.approvalStatus === "PENDING" ? <Badge tone="warning">Ej godkänt</Badge> : u.approvalStatus === "CHANGE_REQUESTED" ? <Badge tone="warning">Ändring begärd</Badge> : <Badge tone="success">Godkänt</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Registrerade timmar {formatMonthYear(live.month.year, live.month.month)}</CardTitle><CardDescription>Per bollplockare. Bara godkänd tid ger ersättning.</CardDescription></CardHeader>
        <CardContent className="p-0">
          {live.month.totals.length === 0 ? <EmptyState title="Inga avslutade pass den här månaden" /> : (
            <TableWrap className="rounded-none border-0 shadow-none">
              <Table>
                <thead><tr><Th>Anställd</Th><Th align="right">Pass</Th><Th align="right">Registrerat</Th><Th align="right">Godkänt</Th><Th align="right">Väntar</Th><Th align="right">Kräver granskning</Th><Th align="right">Pauser</Th></tr></thead>
                <tbody>
                  {live.month.totals.map((t) => (
                    <tr key={t.employeeId}>
                      <Td className="font-medium">{t.employeeName}</Td><Td align="right">{t.sessions}</Td><Td align="right">{formatDuration(t.registeredMinutes)}</Td>
                      <Td align="right">{formatDuration(t.approvedMinutes)}</Td><Td align="right">{formatDuration(t.pendingMinutes)}</Td>
                      <Td align="right">{t.needsReview || "–"}</Td><Td align="right">{t.pauses || "–"}</Td>
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
