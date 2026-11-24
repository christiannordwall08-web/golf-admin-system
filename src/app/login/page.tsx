import { Flag, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/layout/brand";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionUser, homeOf } from "@/server/auth/current-user";
import { isDevPreviewEnabled } from "@/server/dev-preview";

export const metadata: Metadata = { title: "Logga in" };

/** Val mellan de två inloggningarna. `next` följer med så att man hamnar rätt efter inloggning. */
export default async function LoginChoicePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSessionUser();
  if (session) redirect(homeOf(session));
  const { next } = await searchParams;
  const suffix = typeof next === "string" && next ? `?next=${encodeURIComponent(next)}` : "";
  // Rätt förval om man kom hit från en adminsida respektive en anställdsida.
  const hint = typeof next === "string" && next.startsWith("/admin") ? "ADMIN" : typeof next === "string" && next ? "EMPLOYEE" : null;

  const options = [
    { key: "ADMIN", href: `/login/admin${suffix}`, icon: ShieldCheck, title: "Admin", text: "Personal, löner, scheman och rapporter för hela anläggningen." },
    { key: "EMPLOYEE", href: `/login/anstalld${suffix}`, icon: Flag, title: "Anställd", text: "Ditt schema och dina timmar i golfshopen eller som bollplockare." },
  ] as const;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <Brand className="mb-8 justify-center" />
        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight">Hur vill du logga in?</h1>
        <p className="mb-6 text-center text-sm text-ink-muted">Det finns två separata inloggningar.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {options.map((o) => (
            <Link key={o.key} href={o.href} className="group block">
              <Card className={`h-full transition-shadow group-hover:shadow-pop ${hint === o.key ? "border-brand-400" : ""}`}>
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <o.icon className="size-6" aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold">{o.title}</h2>
                    <p className="mt-1 text-sm text-ink-muted">{o.text}</p>
                  </div>
                  <span className="mt-auto text-sm font-medium text-brand-700">Fortsätt som {o.title.toLowerCase()} →</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        {isDevPreviewEnabled() ? (
          <p className="mt-6 text-center text-sm">
            <a href="/dev" className="text-warning-700 underline">
              Förhandsvisning: hoppa över inloggning
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
