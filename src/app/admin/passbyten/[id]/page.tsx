import type { Metadata } from "next";
import { SwapDetailPage } from "@/components/swaps/swap-pages";
import { requireAdminArea, toActor } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Passbyte" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fel?: string; klart?: string }> }) {
  const session = await requireAdminArea();
  const sp = await searchParams;
  const notice = sp.fel ? { tone: "danger" as const, text: sp.fel.slice(0, 300) } : sp.klart ? { tone: "success" as const, text: "Beslutet är sparat och berörda har fått en notis." } : undefined;
  return <SwapDetailPage actor={toActor(session)} id={(await params).id} backHref="/admin/passbyten" admin notice={notice} />;
}
