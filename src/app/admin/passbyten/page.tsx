import { ArrowLeftRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SwapStatusBadge } from "@/components/swaps/swap-pages";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { CATEGORY_LABEL } from "@/domain/roles";
import { localToInstant, formatDateLong } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { type SwapRow, listSwapsForAdmin } from "@/server/services/swaps";

export const metadata: Metadata = { title: "Passbyten" };
const KIND = { DIRECT: "Byte med kollega", OPEN: "Öppen förfrågan", EXCHANGE: "Byte av arbetsdag", CHANGE: "Ändringsbegäran" } as const;

function SwapList({ items }: { items: SwapRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((r) => (
        <li key={r.id}>
          <Link href={`/admin/passbyten/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-brand-50/50">
            <span className="min-w-32 font-medium first-letter:uppercase">{formatDateLong(localToInstant(r.shiftDate, "12:00"))}</span>
            <span className="text-ink-muted">{CATEGORY_LABEL[r.category]} · {r.requester}{r.colleague ? ` → ${r.colleague}` : ""} · {KIND[r.kind]}</span>
            <span className="ml-auto"><SwapStatusBadge status={r.status} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminSwapsPage() {
  const session = await requireAdminArea();
  const rows = await listSwapsForAdmin(getDb(), toActor(session));
  const waiting = rows.filter((r) => r.status === "AWAITING_ADMIN");
  const rest = rows.filter((r) => r.status !== "AWAITING_ADMIN");
  return (
    <>
      <PageHeader title="Passbyten" description="Förfrågningar från Golfshop och Bollplockare. Inget ändras i schemat förrän du godkänner." />
      <Card className="mb-6 border-brand-200"><CardContent className="p-0">
        <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">Att besluta ({waiting.length})</h2>
        {waiting.length ? <SwapList items={waiting} /> : <EmptyState icon={ArrowLeftRight} title="Inget väntar på beslut" />}
      </CardContent></Card>
      <Card><CardContent className="p-0">
        <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">Övriga</h2>
        {rest.length ? <SwapList items={rest} /> : <EmptyState title="Inga andra förfrågningar" />}
      </CardContent></Card>
    </>
  );
}
