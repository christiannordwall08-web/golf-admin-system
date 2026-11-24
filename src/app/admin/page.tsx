import { CalendarClock, Flag, Users } from "lucide-react";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Översikt" };

export default async function AdminHome() {
  // Samma kontroll som layouten: en sida ska aldrig förlita sig på att en layout körts.
  const { user } = await requireRole("ADMIN");

  const grouped = await getDb().employee.groupBy({
    by: ["category"],
    where: { status: "ACTIVE" },
    _count: { _all: true },
  });
  const count = (category: "GOLFSHOP" | "BOLLPLOCKARE") =>
    grouped.find((g) => g.category === category)?._count._all ?? 0;
  const golfshop = count("GOLFSHOP");
  const bollplockare = count("BOLLPLOCKARE");

  return (
    <>
      <PageHeader
        title={`Hej ${user.firstName ?? "Admin"}`}
        description="Översikt över golfanläggningens personal."
      />

      <section aria-label="Personal" className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Anställda (aktiva)" value={golfshop + bollplockare} icon={Users} />
        <StatCard label="Golfshop" value={golfshop} icon={Flag} />
        <StatCard label="Bollplockare" value={bollplockare} icon={Users} />
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Dagens schema och väntande åtgärder</CardTitle>
          <CardDescription>Schemalagda idag, pågående pass, timmar, lönekostnad och godkännanden.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={CalendarClock} title="Byggs i nästa etapp">
            Personalregister, schemaläggning och dashboardens övriga nyckeltal kommer i Etapp 2. Siffrorna ovan
            hämtas redan från databasen.
          </EmptyState>
        </CardContent>
      </Card>
    </>
  );
}
