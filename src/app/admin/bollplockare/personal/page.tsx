import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { fullName } from "@/server/queries/mappers";
import { requireAdminArea } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { NewAccountForm, ResetCodeButton } from "../_components/forms";

export const metadata: Metadata = { title: "Bollplockare: konton" };

export default async function Page() {
  await requireAdminArea();
  const people = await getDb().employee.findMany({ where: { category: "BOLLPLOCKARE" }, select: { id: true, firstName: true, lastName: true, status: true, user: { select: { email: true } } }, orderBy: { firstName: "asc" } });
  return (
    <>
      <PageHeader title="Bollplockare: konton" description="Skapa konton med förnamn, efternamn, e-postadress och en personlig kod som du delar ut." />
      <Card className="mb-6">
        <CardHeader><CardTitle>Lägg till bollplockare</CardTitle><CardDescription>Koden är ett slumpat lösenord som visas en enda gång. Bollplockaren loggar in som Anställd → Som bollplockare.</CardDescription></CardHeader>
        <CardContent><NewAccountForm /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Bollplockare ({people.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {people.length === 0 ? <EmptyState title="Inga bollplockare än" /> : (
            <ul className="divide-y divide-line">
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
                  <span className="min-w-40 font-medium">{fullName(p)}</span>
                  <span className="text-ink-muted">{p.user?.email ?? "Inget konto än"}</span>
                  {p.status === "INACTIVE" ? <Badge tone="neutral">Inaktiv</Badge> : null}
                  <div className="ml-auto">{p.user ? <ResetCodeButton employeeId={p.id} name={fullName(p)} /> : null}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
