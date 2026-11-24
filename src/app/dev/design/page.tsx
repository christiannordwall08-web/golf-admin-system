import { CalendarClock, Clock, Flag, Users } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "Komponentgalleri" };

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const SHADE_BG: Record<(typeof SHADES)[number], string> = {
  50: "bg-brand-50", 100: "bg-brand-100", 200: "bg-brand-200", 300: "bg-brand-300", 400: "bg-brand-400", 500: "bg-brand-500",
  600: "bg-brand-600", 700: "bg-brand-700", 800: "bg-brand-800", 900: "bg-brand-900", 950: "bg-brand-950",
};

/** Alla exempeltexter är påhittade och visar bara utseendet. Det är inga riktiga data. */
export default function DesignGallery() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <a href="/dev" className="mb-4 inline-block text-sm text-brand-700 hover:underline">← Förhandsvisning</a>
      <PageHeader title="Komponentgalleri" description="Så ser designsystemet ut. Exempeltexter, inga riktiga data." />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader><CardTitle>Färger</CardTitle><CardDescription>Golfgrön, neutrala ytor och vita kort.</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
              {SHADES.map((s) => (
                <div key={s} className="text-center">
                  <div className={`h-12 rounded-lg border border-line ${SHADE_BG[s]}`} />
                  <p className="mt-1 text-[11px] text-ink-muted">{s}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Statusmarkeringar</CardTitle><CardDescription>Statusarna ur specen. Texten bär alltid betydelsen, färgen är bara stöd.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge tone="neutral">Utkast</Badge>
            <Badge tone="info">Publicerat</Badge>
            <Badge tone="warning">Väntar på godkännande</Badge>
            <Badge tone="success">Godkänt</Badge>
            <Badge tone="warning">Ändringsförfrågan</Badge>
            <Badge tone="brand">Godkänt efter passbyte</Badge>
            <Badge tone="success">Genomfört</Badge>
            <Badge tone="danger">Inställt</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Statistikkort</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Exempel: anställda" value={12} icon={Users} hint="Hint-text under siffran" />
            <StatCard label="Exempel: timmar" value="65 h" icon={Clock} />
            <StatCard label="Exempel: Golfshop" value={7} icon={Flag} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Knappar</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button>Primär</Button>
            <Button variant="secondary">Sekundär</Button>
            <Button variant="ghost">Diskret</Button>
            <Button variant="danger">Ta bort</Button>
            <Button disabled>Avstängd</Button>
            <Button size="sm">Liten</Button>
            <Button size="lg">Stor</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Formulär</CardTitle></CardHeader>
          <CardContent className="grid max-w-md gap-4">
            <div><Label htmlFor="g-name">Namn</Label><Input id="g-name" placeholder="Förnamn Efternamn" /></div>
            <div><Label htmlFor="g-off">Avstängt fält</Label><Input id="g-off" value="Kan inte ändras" disabled readOnly /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Meddelanden</CardTitle><CardDescription>Samma struktur för lyckat, info, varning och fel.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <Notice tone="success" title="Schemat är publicerat">Berörda anställda har fått en notis.</Notice>
            <Notice tone="info">Ny version av passet väntar på godkännande.</Notice>
            <Notice tone="warning" title="Överlappande pass">Den anställde har redan ett pass 13.00–17.00.</Notice>
            <Notice tone="danger" title="Kunde inte spara">Försök igen. Om felet kvarstår, kontakta administratören.</Notice>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tomt tillstånd</CardTitle></CardHeader>
          <CardContent>
            <EmptyState icon={CalendarClock} title="Inga pass den här veckan" action={<Button variant="secondary">Skapa pass</Button>}>
              Så här ser en tom lista ut. Knappen är bara ett exempel.
            </EmptyState>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
