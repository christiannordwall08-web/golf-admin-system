import { CalendarPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { OPEN_SHIFT_STATUS_LABEL } from "@/domain/open-shifts";
import { CATEGORY_LABEL } from "@/domain/roles";
import { addDaysToDateString, stockholmDateOf } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { type AdminOpenShiftRow, getSchedulingSettings, listOpenShiftsForAdmin } from "@/server/services/open-shifts";
import { updateSchedulingSettingsAction } from "./actions";
import { OpenShiftForm } from "./open-shift-form";

export const metadata: Metadata = { title: "Lediga pass" };

const TONE = {
  OPEN: "warning",
  FILLED: "success",
  CANCELLED: "neutral",
} as const;
const FLASH: Record<string, string> = {
  installningar: "Inställningarna är sparade.",
};

function Rows({ items }: { items: AdminOpenShiftRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((r) => (
        <li key={r.id}>
          <Link href={`/admin/lediga-pass/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 hover:bg-brand-50/50">
            <span className="min-w-0 flex-1">
              <span className="block font-medium first-letter:uppercase">{r.label}</span>
              <span className="block text-sm text-ink-muted">
                {CATEGORY_LABEL[r.category]} · {r.autoAssign ? "Först till kvarn" : "Du väljer"}
                {r.status === "OPEN" && r.pendingClaims > 0 ? ` · ${r.pendingClaims} intresseanmälda` : ""}
                {r.filledBy ? ` · ${r.filledBy}` : ""}
              </span>
            </span>
            {r.status === "OPEN" && r.pendingClaims > 0 && !r.autoAssign ? <Badge tone="info">Välj person</Badge> : null}
            <Badge tone={TONE[r.status]}>{OPEN_SHIFT_STATUS_LABEL[r.status]}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminOpenShiftsPage({ searchParams }: { searchParams: Promise<{ klart?: string }> }) {
  const session = await requireAdminArea();
  const db = getDb();
  const [rows, settings] = await Promise.all([listOpenShiftsForAdmin(db, toActor(session)), getSchedulingSettings(db)]);
  const flash = FLASH[(await searchParams).klart ?? ""];
  const open = rows.filter((r) => r.status === "OPEN");
  const closed = rows.filter((r) => r.status !== "OPEN").sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const tomorrow = addDaysToDateString(stockholmDateOf(new Date()), 1);

  return (
    <>
      <PageHeader title="Lediga pass" description="Lägg ut pass som personalen själv kan ta. Bara de som kan jobba då får en notis." />
      {flash ? (
        <Notice tone="success" className="mb-4">
          {flash}
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardContent className="p-0">
              <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Lediga just nu ({open.length})</h2>
              {open.length ? (
                <Rows items={open} />
              ) : (
                <EmptyState icon={CalendarPlus} title="Inga lediga pass">
                  Lägg ut ett pass i formuläret. Personalen får en notis direkt.
                </EmptyState>
              )}
            </CardContent>
          </Card>
          {closed.length ? (
            <Card>
              <CardContent className="p-0">
                <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Tillsatta och indragna (senaste 30 dagarna)</h2>
                <Rows items={closed} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Lägg ut ett ledigt pass</CardTitle>
            </CardHeader>
            <CardContent>
              <OpenShiftForm defaultDate={tomorrow} defaultAuto={settings.openShiftAutoAssignDefault} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inställningar</CardTitle>
              <CardDescription>Gäller lediga pass och passbyten.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={updateSchedulingSettingsAction} className="flex flex-col gap-4 text-sm">
                <label className="flex gap-3">
                  <input type="checkbox" name="autoApproveSwaps" defaultChecked={settings.autoApproveSwaps} className="mt-0.5 size-4" />
                  <span>
                    <span className="block font-medium">Godkänn passbyten automatiskt</span>
                    <span className="block text-ink-muted">
                      När en kollega tackar ja byts passet direkt, om inga regler bryts. Dagsbyten och ändringar avgör du alltid själv.
                    </span>
                  </span>
                </label>
                <div>
                  <label htmlFor="defaultMode" className="mb-1.5 block font-medium">
                    Förval för nya lediga pass
                  </label>
                  <select
                    id="defaultMode"
                    name="defaultMode"
                    defaultValue={settings.openShiftAutoAssignDefault ? "auto" : "choose"}
                    className="h-11 w-full rounded-lg border border-line bg-white px-3 text-base sm:h-10 sm:text-sm"
                  >
                    <option value="auto">Först till kvarn</option>
                    <option value="choose">Jag väljer</option>
                  </select>
                </div>
                <SubmitButton variant="secondary" pendingText="Sparar…">
                  Spara inställningar
                </SubmitButton>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
