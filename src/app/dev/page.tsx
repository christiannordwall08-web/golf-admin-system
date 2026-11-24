import { Flag, MapPin, Palette, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Brand } from "@/components/layout/brand";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { UserRole } from "@/domain/roles";
import { getDb } from "@/server/db";
import { findPreviewUser } from "@/server/dev-preview";

export const metadata: Metadata = { title: "Förhandsvisning" };

const VIEWS: { role: UserRole; segment: string; title: string; who: string; text: string; icon: typeof Flag }[] = [
  { role: "ADMIN", segment: "admin", title: "Admin", who: "Anna Admin", text: "Huvudpanelen: översikt över personalen i båda grupperna.", icon: ShieldCheck },
  { role: "GOLFSHOP", segment: "golfshop", title: "Golfshop", who: "Erik Andersson", text: "Personalens enkla, mobilanpassade panel.", icon: Flag },
  { role: "BOLLPLOCKARE", segment: "bollplockare", title: "Bollplockare", who: "Oscar Nilsson", text: "Platshållare tills Bollplockare-panelen byggs.", icon: MapPin },
];

export default async function DevHome({ searchParams }: { searchParams: Promise<{ saknas?: string }> }) {
  const { saknas } = await searchParams;
  const db = getDb();
  const available = await Promise.all(VIEWS.map(async (v) => Boolean(await findPreviewUser(db, v.role))));
  const missing = available.some((a) => !a) || Boolean(saknas);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <Brand className="mb-8" />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Förhandsvisning</h1>
        <Badge tone="warning">Endast lokalt · testdata</Badge>
      </div>

      <Notice tone="info" className="mb-6">
        Du är i lokalt förhandsvisningsläge. Här loggar du in som ett testkonto med ett klick, utan lösenord, för att se hur varje roll ser det.
        Läget finns inte i drift. Alla behörighetskontroller gäller som vanligt.
      </Notice>

      {missing ? (
        <Notice tone="warning" title="Testdata saknas" className="mb-6">
          Kör <code className="rounded bg-white/70 px-1">npm run db:seed:demo</code> (eller starta med <code className="rounded bg-white/70 px-1">npm run preview</code>, som gör det åt dig).
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {VIEWS.map((v, i) => (
          <Card key={v.role} className="flex flex-col">
            <CardHeader>
              <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <v.icon className="size-5" aria-hidden />
              </span>
              <CardTitle>{v.title}</CardTitle>
              <CardDescription>{v.text}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <p className="mb-3 text-xs text-ink-muted">Som {v.who}</p>
              {available[i] ? (
                // Vanlig länk (inte next/link): GET skapar en session och ska aldrig förhämtas.
                <a
                  href={`/dev/as/${v.segment}`}
                  className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white shadow-card hover:bg-brand-800"
                >
                  Visa som {v.title}
                </a>
              ) : (
                <span className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-stone-100 text-sm text-stone-500">Testkonto saknas</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Palette className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-medium">Komponentgalleri</p>
              <p className="text-sm text-ink-muted">Färger, knappar, statusmarkeringar, meddelanden och tomma tillstånd.</p>
            </div>
          </div>
          <a href="/dev/design" className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium shadow-card hover:bg-brand-50">
            Öppna galleriet
          </a>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Vad som finns just nu</CardTitle>
          <CardDescription>Förhandsvisningen visar det som är byggt. Resten markeras Snart i menyn.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p><Badge tone="success">Klart</Badge> <span className="ml-1">Etapp 1: inloggning, roller, databas, designsystem</span></p>
          <p><Badge tone="neutral">Snart</Badge> <span className="ml-1">Etapp 2: personal, schema, publicering</span></p>
          <p><Badge tone="neutral">Snart</Badge> <span className="ml-1">Etapp 3: Golfshop-panelen, passbyten</span></p>
          <p><Badge tone="neutral">Snart</Badge> <span className="ml-1">Etapp 4–5: tid, lön, rapporter, dagsavslut</span></p>
        </CardContent>
      </Card>
    </main>
  );
}
