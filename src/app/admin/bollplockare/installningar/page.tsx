import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { addDaysToDateString, formatDateLong, localToInstant, stockholmDateOf } from "@/domain/time";
import { getSettings, listOverrides } from "@/modules/bollplockare/server/settings";
import { requireAdminArea } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { removeOverrideAction } from "../actions";
import { OverrideForm, SettingsForm } from "../_components/forms";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Range och GPS-inställningar" };

export default async function Page() {
  await requireAdminArea();
  const today = stockholmDateOf(new Date());
  const [settings, overrides] = await Promise.all([getSettings(getDb()), listOverrides(getDb(), today, addDaysToDateString(today, 365))]);
  return (
    <>
      <PageHeader title="Range och GPS-inställningar" description="Stängningstid, incheckning, GPS-kontroll, påminnelser och lagringstid." />
      <Card className="mb-6">
        <CardHeader><CardTitle>Inställningar</CardTitle><CardDescription>Ändrad stängningstid eller marginal flyttar tidigaste incheckning för alla kommande pass, och berörda bollplockare får en notis.</CardDescription></CardHeader>
        <CardContent><SettingsForm settings={settings} /></CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>Avvikande stängningstid eller stängd dag</CardTitle><CardDescription>Gäller bara det datumet. En stängd dag kan inte schemaläggas och går inte att klocka in på.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-5">
          <OverrideForm />
          {overrides.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {overrides.map((o) => (
                <li key={o.date} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-40 font-medium first-letter:uppercase">{formatDateLong(localToInstant(o.date, "12:00"))}</span>
                  <span>{o.isClosed ? "Stängd dag" : `Stänger ${o.closeTime?.replace(":", ".")}`}</span>
                  {o.note ? <span className="text-ink-muted">{o.note}</span> : null}
                  <form action={removeOverrideAction} className="ml-auto"><input type="hidden" name="date" value={o.date} /><Button type="submit" variant="ghost" size="sm">Ta bort</Button></form>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-muted">Inga avvikande dagar.</p>}
        </CardContent>
      </Card>
      <Notice tone="info" title="Integritet">Positioner följs bara under ett pågående pass. Bara den senaste positionen sparas och den raderas vid utcheckning. Koordinater från pauser raderas efter lagringstiden ovan. Läs docs/BOLLPLOCKARE-GPS.md om vad verksamheten behöver ordna innan GPS används med riktig personal.</Notice>
    </>
  );
}
