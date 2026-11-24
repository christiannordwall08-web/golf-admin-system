import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/layout/brand";
import { Card, CardContent } from "@/components/ui/card";
import { ROLE_HOME } from "@/domain/roles";
import { getSessionUser } from "@/server/auth/current-user";
import { isDevPreviewEnabled } from "@/server/dev-preview";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logga in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSessionUser();
  if (session) redirect(ROLE_HOME[session.user.role]);
  if (isDevPreviewEnabled()) redirect("/dev");

  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Brand className="mb-8 justify-center" />
        <Card>
          <CardContent className="p-6">
            <h1 className="mb-1 text-xl font-semibold tracking-tight">Logga in</h1>
            <p className="mb-5 text-sm text-ink-muted">Använd kontot du fått av administratören.</p>
            <LoginForm next={typeof next === "string" ? next : undefined} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
