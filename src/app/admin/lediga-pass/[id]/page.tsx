import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { CLAIM_STATUS_LABEL, OPEN_SHIFT_STATUS_LABEL } from "@/domain/open-shifts";
import { CATEGORY_LABEL } from "@/domain/roles";
import { formatDateShort, formatTime } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getOpenShiftForAdmin } from "@/server/services/open-shifts";
import { assignOpenShiftAction, cancelOpenShiftAction } from "../actions";

export const metadata: Metadata = { title: "Ledigt pass" };

const FLASH: Record<string, string> = {
  "lagt-ut": "Passet är utlagt. De som kan ta det har fått en notis.",
  tillsatt: "Passet är tillsatt och ligger i personens schema. Alla berörda har fått en notis.",
  indraget: "Passet är indraget. De som anmält intresse har fått en notis.",
};
const STATUS_TONE = {
  OPEN: "warning",
  FILLED: "success",
  CANCELLED: "neutral",
} as const;
const CLAIM_TONE = {
  PENDING: "info",
  ACCEPTED: "success",
  REJECTED: "neutral",
  WITHDRAWN: "neutral",
} as const;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fel?: string; klart?: string }> }) {
  const session = await requireAdminArea();
  const sp = await searchParams;
  const os = await getOpenShiftForAdmin(getDb(), toActor(session), (await params).id).catch((e) => {
    if (e instanceof AppError) return null;
    throw e;
  });
  if (!os) notFound();
  const pending = os.claims.filter((c) => c.status === "PENDING");

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link href="/admin/lediga-pass" className="text-sm text-brand-700 hover:underline">
        ← Alla lediga pass
      </Link>
      <PageHeader
        title={os.label.charAt(0).toUpperCase() + os.label.slice(1)}
        description={`${CATEGORY_LABEL[os.category]} · ${os.autoAssign ? "Först till kvarn" : "Du väljer"}`}
        actions={<Badge tone={STATUS_TONE[os.status]}>{OPEN_SHIFT_STATUS_LABEL[os.status]}</Badge>}
      />
      {sp.fel ? (
        <Notice tone="danger" className="mb-4">
          {sp.fel.slice(0, 300)}
        </Notice>
      ) : null}
      {sp.klart && FLASH[sp.klart] ? (
        <Notice tone="success" className="mb-4">
          {FLASH[sp.klart]}
        </Notice>
      ) : null}

      <Card className="mb-4">
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          {os.notes ? (
            <p className="sm:col-span-2">
              <span className="text-ink-muted">Notering:</span> {os.notes}
            </p>
          ) : null}
          {os.filledBy ? (
            <p>
              <span className="text-ink-muted">Tillsatt:</span> <b>{os.filledBy}</b>
            </p>
          ) : null}
          {os.cancelReason ? (
            <p className="sm:col-span-2">
              <span className="text-ink-muted">Indraget:</span> {os.cancelReason}
            </p>
          ) : null}
          {os.status === "OPEN" ? (
            <p className="sm:col-span-2 text-ink-muted">
              {os.autoAssign
                ? "Den första som kan ta passet får det. Du kan också välja bland anmälningarna nedan."
                : "Välj vem som får passet bland de intresseanmälda."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-0">
          <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Intresseanmälningar ({os.claims.length})</h2>
          {os.claims.length === 0 ? (
            <EmptyState icon={Users} title="Ingen har anmält sig än" />
          ) : (
            <ul className="divide-y divide-line">
              {os.claims.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{c.name}</span>
                    <span className="block text-sm text-ink-muted">
                      {formatDateShort(c.at)} {formatTime(c.at)}
                      {c.blockedBy ? ` · ${c.blockedBy}` : ""}
                    </span>
                  </span>
                  <Badge tone={CLAIM_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</Badge>
                  {os.status === "OPEN" && c.status === "PENDING" && !c.blockedBy ? (
                    <form action={assignOpenShiftAction}>
                      <input type="hidden" name="id" value={os.id} />
                      <input type="hidden" name="claimId" value={c.id} />
                      <SubmitButton size="sm" pendingText="Tillsätter…">
                        Ge passet
                      </SubmitButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {os.status === "OPEN" ? (
        <Card>
          <CardContent>
            <form action={cancelOpenShiftAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={os.id} />
              <div>
                <Label htmlFor="reason">Dra in passet</Label>
                <Input id="reason" name="reason" required minLength={3} maxLength={300} placeholder="Anledning, t.ex. regn: shoppen stänger tidigt" />
              </div>
              <div>
                <ConfirmSubmitButton
                  variant="danger"
                  confirmText={`Dra in passet?${pending.length ? ` ${pending.length} intresseanmälda får en notis.` : ""}`}
                  pendingText="Drar in…"
                >
                  Dra in
                </ConfirmSubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
