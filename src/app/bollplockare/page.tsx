// ÄGS AV BOLLPLOCKARE-UTVECKLAREN (platshållare).
import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Start" };

export default async function BollplockareHome() {
  const { user } = await requireRole("BOLLPLOCKARE");
  return (
    <>
      <PageHeader title={`Hej ${user.firstName ?? ""}!`} description="Din panel som bollplockare." />
      <Card>
        <CardContent>
          <EmptyState icon={MapPin} title="Incheckning och schema kommer hit">
            Bollplockarnas vy med GPS-baserad in- och utcheckning utvecklas separat.
          </EmptyState>
        </CardContent>
      </Card>
    </>
  );
}
