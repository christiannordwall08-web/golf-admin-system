import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalBadge, CategoryBadge, DraftBadge, PhaseBadge } from "@/components/schedule/shift-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { formatDuration } from "@/domain/money";
import { formatDateLong, formatMonthYear, formatTimeRange, localToInstant } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { getShiftForEdit, listSchedulableEmployees } from "@/server/queries/shift-edit";
import { ShiftForm } from "../../shift-form";
import { ShiftStatusActions } from "../../shift-status-actions";

export const metadata: Metadata = { title: "Ändra pass" };

const REASON = { INITIAL: "Första tilldelning", ADMIN_REASSIGNMENT: "Ändrad av Admin", SHIFT_SWAP: "Passbyte" } as const;

export default async function EditShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminArea();
  const { id } = await params;
  const db = getDb();
  const actor = toActor(session);

  let shift;
  try {
    shift = await getShiftForEdit(db, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const employees = await listSchedulableEmployees(db, actor);
  const startsAt = localToInstant(shift.date, shift.from);
  const cancelled = shift.workStatus === "CANCELLED";
  const [year, month] = shift.date.split("-").map(Number);
  const back = `/admin/schema?m=${shift.date.slice(0, 7)}&kat=${shift.category === "GOLFSHOP" ? "golfshop" : "bollplockare"}`;

  return (
    <>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Schema · {formatMonthYear(year, month)}
      </Link>
      <PageHeader
        title={`${shift.employeeName} · ${formatDateLong(startsAt)}`}
        description={`${shift.from}–${shift.to}${shift.endsNextDay ? " (nästa dag)" : ""} · ${formatDuration(shift.minutes)}`}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <CategoryBadge category={shift.category} />
        <DraftBadge publicationStatus={shift.publicationStatus} />
        {shift.publicationStatus === "PUBLISHED" ? <Badge tone="info">Publicerat</Badge> : null}
        <ApprovalBadge status={shift.approvalStatus} />
        {cancelled ? <Badge tone="danger">Inställt</Badge> : shift.phase !== "UPCOMING" ? <PhaseBadge phase={shift.phase} /> : null}
        {shift.notes ? <Badge tone="neutral">{shift.notes}</Badge> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {cancelled ? (
            <Notice tone="warning" title="Passet är inställt">Ett inställt pass kan inte ändras. Återställ det först om det ska ändras.</Notice>
          ) : shift.hasTimeEntry ? (
            <Notice tone="warning" title="Passet har en tidsregistrering">
              Passet kan inte ändras här. Korrigering av registrerad arbetstid görs i ett separat flöde (Etapp 4).
            </Notice>
          ) : (
            <Card>
              <CardContent className="p-5">
                <ShiftForm
                  mode="edit"
                  employees={employees}
                  shift={{ id: shift.id, version: shift.version }}
                  defaults={{ employeeId: shift.employeeId, date: shift.date, from: shift.from, to: shift.to, endsNextDay: shift.endsNextDay, notes: shift.notes ?? "", publish: false }}
                  cancelHref={back}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {!shift.hasTimeEntry ? (
            <Card>
              <CardHeader>
                <CardTitle>{cancelled ? "Återställ pass" : "Ställ in pass"}</CardTitle>
                <CardDescription>Passet raderas aldrig. Det markeras som inställt och historiken finns kvar.</CardDescription>
              </CardHeader>
              <CardContent><ShiftStatusActions id={shift.id} version={shift.version} cancelled={cancelled} /></CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Historik</CardTitle>
              <CardDescription>
                {shift.originalEmployeeName ? `Ursprungligen tilldelat ${shift.originalEmployeeName}.` : "Vem som varit ansvarig för passet."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3 text-sm">
                {shift.history.map((h, i) => (
                  <li key={i}>
                    <p className="font-medium">
                      {REASON[h.reason]}: {h.fromName ? `${h.fromName} → ` : ""}{h.toName}
                    </p>
                    <p className="text-xs text-ink-muted">{h.byName} · {formatDateLong(h.at)} {formatTimeRange(h.at, h.at).split("–")[0]}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
