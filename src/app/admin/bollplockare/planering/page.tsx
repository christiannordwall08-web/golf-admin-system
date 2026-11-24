import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { addDaysToDateString, stockholmDateOf } from "@/domain/time";
import { fullName } from "@/server/queries/mappers";
import { requireAdminArea } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { PlanForm } from "../_components/forms";

export const metadata: Metadata = { title: "Planera bollplockare" };

export default async function Page() {
  await requireAdminArea();
  const people = await getDb().employee.findMany({ where: { category: "BOLLPLOCKARE", status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } });
  const today = stockholmDateOf(new Date());
  return (
    <>
      <PageHeader title="Planera bollplockare" description="Lägg in flera bollplockare och flera dagar på en gång, t.ex. varje måndag och torsdag under en månad." />
      <Card>
        <CardHeader><CardTitle>Schemalägg</CardTitle><CardDescription>Du anger bara vem och vilka dagar. Tiden följer rangens stängningstid. Du kan också dra namn till en dag i schemat.</CardDescription></CardHeader>
        <CardContent><PlanForm people={people.map((p) => ({ id: p.id, name: fullName(p) }))} defaultFrom={today} defaultTo={addDaysToDateString(today, 30)} /></CardContent>
      </Card>
    </>
  );
}
