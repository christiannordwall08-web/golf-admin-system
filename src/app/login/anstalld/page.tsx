import { ArrowLeft, Flag, Layers, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/layout/brand";
import { Card, CardContent } from "@/components/ui/card";
import { type Workplace } from "@/domain/roles";
import { getSessionUser, homeOf } from "@/server/auth/current-user";
import { isDevPreviewEnabled } from "@/server/dev-preview";

export const metadata: Metadata = { title: "Anställd – var jobbar du?" };

const OPTIONS: { key: Workplace; icon: typeof Flag; title: string; text: string }[] = [
  { key: "golfshop", icon: Flag, title: "I golfshopen", text: "Ditt schema, dina timmar, dagsavslut och passbyten i golfshopen." },
  { key: "bollplockare", icon: MapPin, title: "Som bollplockare", text: "Ditt schema och dina timmar som bollplockare." },
  { key: "bada", icon: Layers, title: "Båda", text: "Du jobbar på båda ställena. Du ser alla dina pass samlade och kan växla." },
];

/** Andra steget för Anställd: jobbar du som bollplockare, i golfshopen eller båda? */
export default async function EmployeeWorkplacePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSessionUser();
  if (session) redirect(homeOf(session));
  const { next } = await searchParams;
  const suffix = typeof next === "string" && next ? `?next=${encodeURIComponent(next)}` : "";
  const preview = isDevPreviewEnabled();

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <Brand className="mb-8 justify-center" />
        <Link href="/login" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Välj inloggning
        </Link>
        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight">Jobbar du som bollplockare eller i golfshopen?</h1>
        <p className="mb-6 text-center text-sm text-ink-muted">Välj var du jobbar. Jobbar du på båda ställena väljer du Båda.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {OPTIONS.map((o) => {
            const href = preview ? `/dev/as/${o.key === "bada" ? "alla" : o.key}` : `/login/anstalld/${o.key}${suffix}`;
            const card = (
              <Card className="h-full transition-shadow group-hover:shadow-pop">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <o.icon className="size-6" aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold">{o.title}</h2>
                    <p className="mt-1 text-sm text-ink-muted">{o.text}</p>
                  </div>
                  <span className="mt-auto text-sm font-medium text-brand-700">Fortsätt →</span>
                </CardContent>
              </Card>
            );
            return preview ? (
              // Förhandsvisning: GET skapar en session, så en vanlig länk som aldrig förhämtas.
              <a key={o.key} href={href} className="group block">{card}</a>
            ) : (
              <Link key={o.key} href={href} className="group block">{card}</Link>
            );
          })}
        </div>
        {preview ? (
          <p className="mt-6 text-center text-sm text-warning-700">
            Förhandsvisning (lokalt): du kommer in utan lösenord.{" "}
            <Link href="/login/anstalld/golfshop" className="underline">Visa inloggningsformuläret</Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
