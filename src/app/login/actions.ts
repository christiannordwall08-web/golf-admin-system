"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ROLE_HOME, safeInternalPath } from "@/domain/roles";
import { authenticate } from "@/server/auth/login";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { createSession, revokeSession } from "@/server/auth/session-store";
import { getDb } from "@/server/db";

/** `email` skickas tillbaka så att fältet inte töms när React återställer formuläret. Aldrig lösenordet. */
export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
  next: z.string().max(500).optional(),
});

const GENERIC_ERROR =
  "Felaktig e-postadress eller lösenord. Efter flera felaktiga försök spärras kontot tillfälligt.";

/** Klientens IP enligt proxyn framför appen. Pålitlig endast bakom en betrodd proxy (se docs/ARCHITECTURE.md). */
function clientIp(h: Headers): string | null {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || null;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const submittedEmail = typeof formData.get("email") === "string" ? (formData.get("email") as string).slice(0, 254) : "";
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Fyll i e-postadress och lösenord.", email: submittedEmail };

  const db = getDb();
  const h = await headers();
  const ipAddress = clientIp(h);

  const result = await authenticate(db, { email: parsed.data.email, password: parsed.data.password, ipAddress });
  if (!result.ok) return { error: GENERIC_ERROR, email: parsed.data.email };

  const { token, expiresAt } = await createSession(db, result.user.id, {
    ipAddress,
    userAgent: h.get("user-agent"),
  });
  await setSessionCookie(token, expiresAt);

  // `next` accepteras bara som intern sökväg. Fel roll studsas av layouten till egen startsida.
  redirect(safeInternalPath(parsed.data.next, ROLE_HOME[result.user.role]));
}

export async function logoutAction(): Promise<void> {
  await revokeSession(getDb(), await readSessionToken());
  await clearSessionCookie();
  redirect("/login");
}
