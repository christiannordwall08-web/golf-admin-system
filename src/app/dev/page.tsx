import { Flag, MapPin, Palette, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Brand } from "@/components/layout/brand";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getDb } from "@/server/db";
import { PREVIEW_COOKIE, findPreviewProfile } from "@/server/dev-preview";
import { CreateProfileForm } from "./create-profile-form";

export const metadata: Metadata = { title: "Förhandsvisning" };

const linkBtn = "inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white shadow-card hover:bg-brand-800";

export default async function DevHome({ searchParams }: { searchParams: Promise<{ saknas?: string; ny?: string }> }) {
  const sp = await searchParams;
  const profile = await findPreviewProfile(getDb(), (await cookies()).get(PREVIEW_COOKIE)?.value);
  const creating = !profile || sp.ny === "1";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <Brand className="mb-8" />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Förhandsvisning</h1>
        <Badge tone="warning">Endast lokalt · testdata</Badge>
      </div>

      <Notice tone="info" className="mb-6">
        Lokalt förhandsvisningsläge: du kommer in utan lösenord för att se hur allt ser ut. Det finns två separata inloggningar, Admin och
        Anställd, och här kan samma person prova båda. Läget finns inte i drift och alla behörighetskontroller gäller som vanligt.
      </Notice>
      {sp.saknas ? <Notice tone="warning" title="Anställningen saknas" className="mb-6">Testprofilen saknar anställning där. Skapa ett nytt konto.</Notice> : null}

      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>Skapa ditt konto</CardTitle>
            <CardDescription>
              Bara förnamn och efternamn. Kontot blir administratör och anställd i både Golfshop och Bollplockare, med timlön och ett testschema, så att du kan se alla vyer.
            </CardDescription>
          </CardHeader>
          <CardContent><CreateProfileForm /></CardContent>
        </Card>
      ) : null}

      {profile ? (
        <>
          <p className="mb-3 mt-2 text-sm text-ink-muted">Testprofil: <span className="font-medium text-ink">{profile.name}</span> · <a href="/dev?ny=1" className="text-brand-700 underline">skapa ett annat konto</a></p>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { mode: "admin", icon: ShieldCheck, title: "Admin-inloggning", text: "Alla anställda, löner, arbetade och kommande timmar samt hela scheman för både Golfshop och Bollplockare.", label: "Logga in som Admin" },
              { mode: "golfshop", icon: Flag, title: "Anställd · Golfshop", text: "Mitt schema och mina timmar i golfshopen. Bara mina egna uppgifter.", label: "Logga in som anställd" },
              { mode: "bollplockare", icon: MapPin, title: "Anställd · Bollplockare", text: "Samma anställdpanel för bollplockare (GPS-delen byggs separat).", label: "Logga in som anställd" },
            ].map((v) => (
              <Card key={v.mode} className="flex flex-col">
                <CardHeader>
                  <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><v.icon className="size-5" aria-hidden /></span>
                  <CardTitle>{v.title}</CardTitle>
                  <CardDescription>{v.text}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  {/* Vanlig länk (inte next/link): GET skapar en session och ska aldrig förhämtas. */}
                  <a href={`/dev/as/${v.mode}`} className={linkBtn}>{v.label}</a>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Palette className="size-5" aria-hidden /></span>
            <div>
              <p className="font-medium">Komponentgalleri och riktiga inloggningssidor</p>
              <p className="text-sm text-ink-muted">Färger, knappar, statusmarkeringar och hur inloggningsvalet ser ut.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <a href="/dev/design" className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium shadow-card hover:bg-brand-50">Galleri</a>
            <a href="/login" className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium shadow-card hover:bg-brand-50">Inloggningsval</a>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
