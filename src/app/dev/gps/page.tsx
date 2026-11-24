import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getWorkArea } from "@/modules/bollplockare/server/settings";
import { getDb } from "@/server/db";
import { PREVIEW_COOKIE, findPreviewProfile } from "@/server/dev-preview";
import { createTestAreaAction, createTestShiftAction } from "./actions";

export const metadata: Metadata = { title: "GPS-simulering (utveckling)" };

export default async function Page({ searchParams }: { searchParams: Promise<{ klart?: string; fel?: string }> }) {
  const sp = await searchParams;
  const profile = await findPreviewProfile(getDb(), (await cookies()).get(PREVIEW_COOKIE)?.value);
  const area = await getWorkArea(getDb());
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <Brand className="mb-8" />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">GPS-simulering</h1>
        <Badge tone="warning">Endast lokalt · utveckling</Badge>
      </div>
      <Notice tone="warning" className="mb-6" title="Finns inte i drift">
        Det här är ett testverktyg för att prova klocka in/ut, geofencing, pauser och notiser utan att befinna sig på golfbanan. Simuleringen skickar påhittade positioner genom samma serverkod som riktiga, och är avstängd i drift (hela /dev ger 404).
      </Notice>
      {!profile ? <Notice tone="info" className="mb-6">Skapa först ett testkonto på <Link href="/dev" className="underline">/dev</Link>.</Notice> : null}
      {sp.klart ? <Notice tone="success" className="mb-6">Testpasset är inlagt. Öppna Anställd → Bollplockare, välj en simulerad position och klocka in.</Notice> : null}
      {sp.fel ? <Notice tone="danger" className="mb-6">Testkontot saknar anställning som bollplockare. Skapa ett nytt testkonto.</Notice> : null}

      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FlaskConical className="size-5" aria-hidden /> 1. Arbetsområde</CardTitle><CardDescription>{area.configured ? `Området är inställt (${area.rings.length} delområde, marginal ${area.marginMeters} m). Simuleringen utgår från det.` : "Inget område är ritat än."}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {!area.configured ? <form action={createTestAreaAction}><Button type="submit">Skapa fiktivt testområde</Button></form> : null}
            <Link href="/admin/bollplockare/omrade" className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium shadow-card hover:bg-brand-50">Rita det riktiga området (Admin)</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>2. Testpass som kan klockas in nu</CardTitle><CardDescription>Lägger in ett publicerat pass åt testkontot idag och sätter rangens stängningstid så att incheckning är öppen. Ändrar bara dagens datum.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <form action={createTestShiftAction}><Button type="submit" disabled={!profile || !area.configured}>Skapa testpass idag</Button></form>
            {/* Vanlig länk: GET skapar en session och ska aldrig förhämtas. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/dev/as/bollplockare" className="inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white shadow-card hover:bg-brand-800">Öppna som bollplockare</a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/dev/as/admin" className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium shadow-card hover:bg-brand-50">Öppna som Admin</a>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
