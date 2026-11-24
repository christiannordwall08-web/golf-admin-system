import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Start" };

export default async function GolfshopHome() {
  const { user } = await requireRole("GOLFSHOP");
  return (
    <>
      <PageHeader title={`Hej ${user.firstName ?? ""}!`} description="Din personliga panel i golfshopen." />
      <Card>
        <CardContent>
          <EmptyState icon={CalendarDays} title="Dina arbetspass kommer hit">
            Schema, godkännande av pass, mina timmar, passbyten och dagsavslut byggs i kommande etapper.
          </EmptyState>
        </CardContent>
      </Card>
    </>
  );
}
