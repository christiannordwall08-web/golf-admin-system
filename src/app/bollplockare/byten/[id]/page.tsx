import type { Metadata } from "next";
import { SwapDetailPage } from "@/components/swaps/swap-pages";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Passbyte" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { session } = await requireEmployeeArea("BOLLPLOCKARE");
  return <SwapDetailPage actor={toActor(session)} id={(await params).id} category="BOLLPLOCKARE" backHref="/bollplockare/byten" />;
}
