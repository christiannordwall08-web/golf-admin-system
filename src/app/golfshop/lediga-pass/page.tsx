import type { Metadata } from "next";
import { EmployeeOpenShiftsPage } from "@/components/open-shifts/employee-open-shifts";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Lediga pass" };

export default async function Page({ searchParams }: { searchParams: Promise<{ klart?: string; fel?: string }> }) {
  const { session } = await requireEmployeeArea("GOLFSHOP");
  return <EmployeeOpenShiftsPage actor={toActor(session)} category="GOLFSHOP" searchParams={await searchParams} />;
}
