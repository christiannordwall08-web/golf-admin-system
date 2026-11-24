import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/layout/brand";
import { Card, CardContent } from "@/components/ui/card";
import type { SessionContext } from "@/domain/roles";
import { getSessionUser, homeOf } from "@/server/auth/current-user";
import { isDevPreviewEnabled } from "@/server/dev-preview";
import { LoginForm } from "./login-form";

const COPY = {
  ADMIN: {
    title: "Admin-inloggning",
    text: "För dig som administrerar personal, scheman, arbetstid och löner.",
    otherHref: "/login/anstalld",
    otherText: "Är du anställd? Logga in här",
  },
  EMPLOYEE: {
    title: "Anställd-inloggning",
    text: "För dig som jobbar i golfshopen eller som bollplockare. Du ser ditt eget schema och dina timmar.",
    otherHref: "/login/admin",
    otherText: "Är du administratör? Logga in här",
  },
} as const;

/** Gemensam sida för de två inloggningarna. Skickar redan inloggade till sin startsida. */
export async function LoginPanel({ audience, next }: { audience: SessionContext; next?: string }) {
  const session = await getSessionUser();
  if (session) redirect(homeOf(session));
  const copy = COPY[audience];

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Brand className="mb-8 justify-center" />
        <Card>
          <CardContent className="p-6">
            <Link href="/login" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
              <ArrowLeft className="size-4" aria-hidden /> Välj inloggning
            </Link>
            <h1 className="mb-1 text-xl font-semibold tracking-tight">{copy.title}</h1>
            <p className="mb-5 text-sm text-ink-muted">{copy.text}</p>
            <LoginForm audience={audience} next={next} />
            <p className="mt-5 text-center text-sm">
              <Link href={copy.otherHref} className="text-brand-700 hover:underline">
                {copy.otherText}
              </Link>
            </p>
          </CardContent>
        </Card>
        {isDevPreviewEnabled() ? (
          <p className="mt-4 text-center text-sm">
            <a href="/dev" className="text-warning-700 underline">
              Förhandsvisning: hoppa över inloggning
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
