import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import type { WorkCategory } from "@/domain/roles";
import { dbDateToString, formatDateLong, formatDateShort, formatTime, localToInstant } from "@/domain/time";
import { getDb } from "@/server/db";
import type { Actor } from "@/server/services/pay-rates";
import { type SwapRow, getSwapDetail, listColleagueShifts, listColleagues, listMySwaps } from "@/server/services/swaps";
import { cancelSwapAction, decideSwapAction, messageSwapAction, respondSwapAction } from "./actions";
import { NewSwapForm } from "./new-swap-form";

const STATUS: Record<SwapRow["status"], { tone: "warning" | "info" | "success" | "danger" | "neutral"; text: string }> = {
  AWAITING_COLLEAGUE: { tone: "warning", text: "Väntar på kollega" },
  AWAITING_ADMIN: { tone: "info", text: "Väntar på admin" },
  DECLINED_BY_COLLEAGUE: { tone: "danger", text: "Nekad av kollega" },
  APPROVED: { tone: "success", text: "Godkänd" },
  DENIED: { tone: "danger", text: "Nekad av admin" },
  CANCELLED: { tone: "neutral", text: "Avbruten" },
};
const KIND: Record<SwapRow["kind"], string> = { DIRECT: "Byte med kollega", OPEN: "Öppen förfrågan", EXCHANGE: "Byte av arbetsdag", CHANGE: "Ändringsbegäran" };
const day = (d: string) => formatDateLong(localToInstant(d, "12:00"));

export function SwapStatusBadge({ status }: { status: SwapRow["status"] }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].text}</Badge>;
}

/** Min lista över passbyten: sådana som väntar på mig först. */
export async function SwapListPage({ actor, category, base }: { actor: Actor; category: WorkCategory; base: string }) {
  const rows = await listMySwaps(getDb(), actor, category);
  const waiting = rows.filter((r) => r.needsMyAnswer);
  const mine = rows.filter((r) => r.mine);
  const Row = ({ r }: { r: SwapRow }) => (
    <li>
      <Link href={`${base}/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-brand-50/50">
        <span className="min-w-32 font-medium first-letter:uppercase">{day(r.shiftDate)}</span>
        <span className="text-ink-muted">{r.mine ? KIND[r.kind] : `${r.requester} · ${KIND[r.kind]}`}{r.counterDate ? ` (mot ${r.counterDate})` : ""}</span>
        <span className="ml-auto"><SwapStatusBadge status={r.status} /></span>
      </Link>
    </li>
  );
  return (
    <>
      <PageHeader title="Passbyten" description="Byt pass med en kollega eller be om ändring. Admin godkänner alltid." actions={<Link href={`${base}/ny`} className={buttonVariants({ variant: "primary" })}>Nytt passbyte</Link>} />
      {waiting.length > 0 ? (
        <Card className="mb-6 border-warning-200">
          <CardContent className="p-0">
            <h2 className="border-b border-line px-4 py-2 text-sm font-semibold text-warning-700">Väntar på ditt svar</h2>
            <ul className="divide-y divide-line">{waiting.map((r) => <Row key={r.id} r={r} />)}</ul>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="p-0">
          <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">Mina förfrågningar</h2>
          {mine.length === 0 ? <EmptyState icon={ArrowLeftRight} title="Inga passbyten ännu">Du kan be en kollega ta ett pass eller begära en ändring.</EmptyState> : <ul className="divide-y divide-line">{mine.map((r) => <Row key={r.id} r={r} />)}</ul>}
        </CardContent>
      </Card>
    </>
  );
}

export async function NewSwapPage({ actor, category, shiftId }: { actor: Actor; category: WorkCategory; shiftId?: string }) {
  const db = getDb();
  const now = new Date();
  const mine = await db.shift.findMany({
    where: { assignedEmployee: { userId: actor.id, category }, category, publicationStatus: "PUBLISHED", workStatus: { not: "CANCELLED" }, endsAt: { gt: now }, workTimeEntry: null },
    orderBy: { startsAt: "asc" },
    take: 40,
  });
  const [colleagues, colleagueShifts] = await Promise.all([listColleagues(db, actor, category), listColleagueShifts(db, actor, category, now)]);
  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title="Nytt passbyte" description="Inget ändras i schemat förrän admin godkänt." />
      {mine.length === 0 ? (
        <Card><EmptyState icon={ArrowLeftRight} title="Du har inga pass som kan bytas">Bara kommande, publicerade pass som du inte börjat arbeta på kan bytas.</EmptyState></Card>
      ) : (
        <NewSwapForm
          category={category}
          shiftId={shiftId}
          shifts={mine.map((s) => ({ id: s.id, label: day(dbDateToString(s.localDate)) }))}
          colleagues={colleagues.map((c) => ({ id: c.id, label: c.name }))}
          colleagueShifts={colleagueShifts.map((c) => ({ id: c.id, label: `${day(c.date)} (${c.employeeName})` }))}
        />
      )}
    </div>
  );
}

/** Detaljsida med tråd och åtgärder. `admin` = Admins vy (beslut), annars personalens. */
export async function SwapDetailPage({ actor, id, category, backHref, admin = false, notice }: { actor: Actor; id: string; category?: WorkCategory; backHref: string; admin?: boolean; notice?: { tone: "success" | "danger"; text: string } }) {
  const d = await getSwapDetail(getDb(), actor, id).catch(() => null);
  if (!d) notFound();
  const r = d.row;
  const cat = category ?? r.category;
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link href={backHref} className="text-sm text-brand-700 hover:underline">← Alla passbyten</Link>
      <PageHeader title={KIND[r.kind]} description={`${r.requester} · ${day(r.shiftDate)}`} actions={<SwapStatusBadge status={r.status} />} />
      {notice ? <Notice tone={notice.tone} className="mb-4">{notice.text}</Notice> : null}
      <Card className="mb-4">
        <CardContent className="grid gap-2 p-5 text-sm sm:grid-cols-2">
          <p><span className="text-ink-muted">Pass:</span> <b className="first-letter:uppercase">{day(r.shiftDate)}</b></p>
          {r.counterDate ? <p><span className="text-ink-muted">Byter mot:</span> <b>{day(r.counterDate)}</b></p> : null}
          <p><span className="text-ink-muted">Från:</span> <b>{r.requester}</b></p>
          <p><span className="text-ink-muted">Kollega:</span> <b>{r.colleague ?? (r.kind === "OPEN" ? "Ingen än (öppen)" : "–")}</b></p>
          {r.adminComment ? <p className="sm:col-span-2"><span className="text-ink-muted">Admins kommentar:</span> {r.adminComment}</p> : null}
        </CardContent>
      </Card>

      {d.canRespond ? (
        <Card className="mb-4 border-warning-200"><CardContent className="p-4">
          <p className="mb-3 text-sm font-semibold">Kan du ta det här passet?</p>
          <form action={respondSwapAction} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="category" value={cat} />
            <input name="comment" maxLength={500} placeholder="Valfri kommentar" className="h-10 rounded-lg border border-line bg-white px-3 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <Button type="submit" name="decision" value="accept" size="lg">Ja, jag tar det</Button>
              <Button type="submit" name="decision" value="decline" variant="secondary" size="lg">Nej</Button>
            </div>
          </form>
        </CardContent></Card>
      ) : null}

      {d.canDecide ? (
        <Card className="mb-4 border-brand-200"><CardContent className="p-4">
          <p className="mb-3 text-sm font-semibold">Beslut</p>
          <form action={decideSwapAction} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={id} />
            <input name="comment" maxLength={500} placeholder="Kommentar (krävs om du nekar)" className="h-10 rounded-lg border border-line bg-white px-3 text-sm" />
            <div className="flex gap-3">
              <Button type="submit" name="decision" value="approve">Godkänn</Button>
              <Button type="submit" name="decision" value="deny" variant="danger">Neka</Button>
            </div>
          </form>
        </CardContent></Card>
      ) : null}

      <Card className="mb-4"><CardContent className="p-0">
        <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">Meddelanden</h2>
        <ul className="divide-y divide-line">
          {d.messages.map((m) => (
            <li key={m.id} className="px-4 py-2.5 text-sm">
              <p className="text-xs text-ink-muted">{m.author}{m.isAdmin ? " (admin)" : ""} · {formatDateShort(m.at)} {formatTime(m.at)}</p>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
        {["AWAITING_COLLEAGUE", "AWAITING_ADMIN"].includes(r.status) ? (
          <form action={messageSwapAction} className="flex gap-2 border-t border-line p-3">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={admin ? `/admin/passbyten/${id}` : `${backHref}/${id}`} />
            <input name="body" required maxLength={500} placeholder="Skriv ett meddelande" aria-label="Meddelande" className="h-10 flex-1 rounded-lg border border-line bg-white px-3 text-sm" />
            <Button type="submit" variant="secondary">Skicka</Button>
          </form>
        ) : null}
      </CardContent></Card>

      {d.canCancel ? (
        <form action={cancelSwapAction}>
          <input type="hidden" name="id" value={id} /><input type="hidden" name="category" value={cat} />
          <Button type="submit" variant="ghost">Avbryt förfrågan</Button>
        </form>
      ) : null}
    </div>
  );
}
