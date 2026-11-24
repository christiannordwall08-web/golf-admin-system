import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings } from "@/modules/bollplockare/server/settings";
import { requireEmployeeArea } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Min profil" };

export default async function Page() {
  const { session, employee } = await requireEmployeeArea("BOLLPLOCKARE");
  const e = await getDb().employee.findUniqueOrThrow({ where: { id: employee.id }, select: { firstName: true, lastName: true, user: { select: { email: true } } } });
  const settings = await getSettings(getDb());
  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title="Min profil" description="Dina uppgifter och hur din position används." />
      <Card className="mb-4"><CardContent className="grid gap-2 p-5 text-sm">
        <p><span className="text-ink-muted">Namn:</span> <b>{e.firstName} {e.lastName}</b></p>
        <p><span className="text-ink-muted">E-post (inloggning):</span> <b>{e.user?.email ?? session.user.email}</b></p>
        <p><span className="text-ink-muted">Arbetsplats:</span> <b>Bollplockare</b></p>
        <p className="text-xs text-ink-muted">Byte av namn eller e-post görs av admin. Din personliga kod får du av admin.</p>
      </CardContent></Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-brand-700" aria-hidden /> Din position och integritet</CardTitle><CardDescription>Så här hanteras platsuppgifter.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>Din position hämtas <b>bara</b> när du är incheckad, för att kontrollera att du befinner dig på golfanläggningen, och slutar följas direkt när du klockar ut. Aldrig på fritiden.</p>
          <p>Bara den senaste positionen sparas under passet (ingen rörelsehistorik) och den raderas när du klockar ut. Om tiden pausas för att du lämnat området sparas var det hände i högst {settings.gpsRetentionDays} dagar.</p>
          <p>Bara admin kan se positionen, och bara under ditt pågående pass. En paus kan alltid granskas och rättas av admin, den är aldrig ett automatiskt löneavdrag.</p>
          <Notice tone="info" className="mt-2">Frågor om hur dina uppgifter används? Kontakta admin.</Notice>
          <Link href="/bollplockare/notiser" className="text-brand-700 hover:underline">Mina notiser →</Link>
        </CardContent>
      </Card>
    </div>
  );
}
