"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  type Workplace,
  hasWorkplace,
  homeFor,
  homeForWorkplace,
  isPathAllowedForContext,
  primaryCategory,
  safeInternalPath,
  workplaceFromSegment,
} from "@/domain/roles";
import { authenticate } from "@/server/auth/login";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { createSession, revokeSession } from "@/server/auth/session-store";
import { getDb } from "@/server/db";
import { isDevPreviewEnabled } from "@/server/dev-preview";

/** `email` skickas tillbaka så att fältet inte töms när React återställer formuläret. Aldrig lösenordet. */
export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
  audience: z.enum(["ADMIN", "EMPLOYEE"]),
  next: z.string().max(500).optional(),
  /** Anställd: golfshop | bollplockare | bada. Styr bara var man hamnar; anställningen kontrolleras ändå. */
  workplace: z.string().max(20).optional(),
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
    audience: formData.get("audience"),
    next: formData.get("next") || undefined,
    workplace: formData.get("workplace") || undefined,
  });
  if (!parsed.success) return { error: "Fyll i e-postadress och lösenord.", email: submittedEmail };

  const db = getDb();
  const h = await headers();
  const ipAddress = clientIp(h);
  const { audience } = parsed.data;
  const workplace: Workplace | null = audience === "EMPLOYEE" ? workplaceFromSegment(parsed.data.workplace) : null;

  const result = await authenticate(db, { email: parsed.data.email, password: parsed.data.password, audience, ipAddress });
  if (!result.ok) {
    if (result.reason === "WRONG_AUDIENCE") {
      return {
        error:
          audience === "ADMIN"
            ? "Det här kontot är inte administratör. Logga in som Anställd i stället."
            : "Det här kontot är inte registrerat som anställd. Logga in som Admin i stället.",
        email: parsed.data.email,
      };
    }
    return { error: GENERIC_ERROR, email: parsed.data.email };
  }

  const employments = await db.employee.findMany({
    where: { userId: result.user.id, status: "ACTIVE" },
    select: { category: true },
  });
  const categories = employments.map((e) => e.category);
  // Valet "var jobbar du" måste stämma med de verkliga anställningarna (annars inget konto-läckage, bara ett tydligt fel).
  if (workplace && !hasWorkplace(categories, workplace)) {
    return {
      error:
        workplace === "bada"
          ? "Det här kontot är inte anställt på båda ställena. Gå tillbaka och välj Golfshop eller Bollplockare."
          : `Det här kontot är inte anställt ${workplace === "golfshop" ? "i golfshopen" : "som bollplockare"}. Gå tillbaka och välj var du jobbar.`,
      email: parsed.data.email,
    };
  }

  const { token, expiresAt } = await createSession(db, result.user.id, result.context, {
    ipAddress,
    userAgent: h.get("user-agent"),
  });
  await setSessionCookie(token, expiresAt);

  // Startsida efter inloggningstyp och val. `next` får bara vara en intern sökväg som hör till inloggningen.
  const home = workplace ? homeForWorkplace(workplace) : homeFor(result.context, primaryCategory(result.user.role, categories));
  const next = safeInternalPath(parsed.data.next, home);
  redirect(isPathAllowedForContext(result.context, next) ? next : home);
}

export async function logoutAction(): Promise<void> {
  await revokeSession(getDb(), await readSessionToken());
  await clearSessionCookie();
  redirect(isDevPreviewEnabled() ? "/dev" : "/login");
}

