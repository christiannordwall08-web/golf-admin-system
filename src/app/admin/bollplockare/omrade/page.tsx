import type { Metadata } from "next";
import { AreaEditor } from "@/components/map/area-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getWorkArea } from "@/modules/bollplockare/server/settings";
import { requireAdminArea } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Karta och arbetsområde" };

export default async function Page() {
  await requireAdminArea();
  const area = await getWorkArea(getDb());
  return (
    <>
      <PageHeader title="Karta och arbetsområde" description="Rita golfanläggningens gränser. Bollplockare kan klocka in och arbeta fritt inom området och säkerhetsmarginalen." />
      <Notice tone="info" title="Så här gör du" className="mb-4">
        Zooma in på golfanläggningen. Klicka för att sätta hörn runt hela området (driving range, bana, golfshop, klubbhus, maskinhall, bolltvätt, förråd och parkering). Dra i ett hörn för att flytta det, dubbelklicka för att ta bort det.
        Behöver området flera delar, tryck <b>Nytt delområde</b>. Välj <b>Testa position</b> för att klicka på kartan och se vilken zon en punkt hamnar i. Tryck <b>Spara</b> när du är nöjd.
      </Notice>
      <Card>
        <CardHeader><CardTitle>Arbetsområde</CardTitle><CardDescription>Grön yta = godkänt område. Streckad gul yta = säkerhetsmarginal. Utanför den pausas tiden efter verifiering.</CardDescription></CardHeader>
        <CardContent>
          <AreaEditor initialRings={area.rings} initialMargin={area.marginMeters} version={area.version} />
          <p className="mt-3 text-xs text-ink-muted">Kartdata © OpenStreetMap-bidragsgivare. Marginalen mäts från områdets yttersta gräns, aldrig från en mittpunkt.</p>
        </CardContent>
      </Card>
    </>
  );
}
