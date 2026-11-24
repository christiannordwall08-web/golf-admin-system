import type { Metadata } from "next";
import { SwapListPage } from "@/components/swaps/swap-pages";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Passbyten" };

export default async function Page() {
  const { session } = await requireEmployeeArea("GOLFSHOP");
  return <SwapListPage actor={toActor(session)} category="GOLFSHOP" base="/golfshop/byten" />;
}
