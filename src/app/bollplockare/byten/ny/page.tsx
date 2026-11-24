import type { Metadata } from "next";
import { NewSwapPage } from "@/components/swaps/swap-pages";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Nytt passbyte" };

export default async function Page({ searchParams }: { searchParams: Promise<{ pass?: string }> }) {
  const { session } = await requireEmployeeArea("BOLLPLOCKARE");
  const { pass } = await searchParams;
  return <NewSwapPage actor={toActor(session)} category="BOLLPLOCKARE" shiftId={typeof pass === "string" ? pass : undefined} />;
}
