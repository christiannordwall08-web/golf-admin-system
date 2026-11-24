import { Flag, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/layout/brand";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionUser, homeOf } from "@/server/auth/current-user";
import { isDevPreviewEnabled } from "@/server/dev-preview";

export const metadata: Metadata = { title: "Logga in" };

/**
 * Första steget: två inloggningar, Admin och Anställd. `next` följer med så att man hamnar rätt efter inloggning.
 * I lokalt förhandsvisningsläge går Admin direkt in (utan lösenord) som testkontot.
 */
export default async function LoginChoicePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSessionUser();
  if (session) redirect(homeOf(session));
  const { next } = await searchParams;
  const suffix = typeof next === "string" && next ? `?next=${encodeURIComponent(next)}` : "";
  // Rätt förval om man kom hit från en adminsida respektive en anställdsida.
  const hint = typeof next === "string" && next.startsWith("/admin") ? "ADMIN" : typeof next === "string" && next ? "EMPLOYEE" : null;
  const preview = isDevPreviewEnabled();

  const options = [
    { key: "ADMIN", href: preview ? "/dev/as/admin" : `/login/admin${suffix}`, icon: ShieldCheck, title: "Admin", text: "Personal, löner, scheman och rapporter för hela anläggningen." },
    { key: "EMPLOYEE", href: `/login/anstalld${suffix}`, icon: Flag, title: "Anställd", text: "Ditt schema och dina timmar i golfshopen och/eller som bollplockare." },
  ] as const;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <Brand className="mb-8 justify-center" />
        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight">Hur vill du logga in?</h1>
        <p className="mb-6 text-center text-sm text-ink-muted">Det finns två separata inloggningar.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {options.map((o) => (
            // Vanlig länk (inte next/link) när den startar en förhandsvisningssession: GET skapar en session och ska aldrig förhämtas.
            <ChoiceLink key={o.key} href={o.href} plain={o.href.startsWith("/dev/")}>
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
            </ChoiceLink>
          ))}
        </div>
        {preview ? (
          <p className="mt-6 text-center text-sm text-warning-700">
            Förhandsvisning (lokalt): du kommer in utan lösenord.{" "}
            <Link href="/login/admin" className="underline">Visa inloggningsformuläret</Link>
            {" · "}
            <a href="/dev" className="underline">Testkonto och vyer</a>
          </p>
        ) : null}
      </div>
    </main>
  );
}

function ChoiceLink({ href, plain, children }: { href: string; plain?: boolean; children: React.ReactNode }) {
  return plain ? (
    <a href={href} className="group block">{children}</a>
  ) : (
    <Link href={href} className="group block">{children}</Link>
  );
}
