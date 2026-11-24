"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ensureTestWorkArea } from "@/modules/bollplockare/server/simulation";
import { getDb } from "@/server/db";
import { PREVIEW_COOKIE, isDevPreviewEnabled, isPreviewDemoData } from "@/server/dev-preview";
import { createPreviewProfile } from "@/server/dev-preview-profile";
import { ValidationError } from "@/server/errors";

export type CreateProfileState = { error?: string; firstName?: string; lastName?: string };

const schema = z.object({ firstName: z.string().max(80), lastName: z.string().max(80) });

/** Förhandsvisning: skapar testprofilen (admin + anställd i båda grupperna) från bara för- och efternamn. */
export async function createPreviewProfileAction(_prev: CreateProfileState, formData: FormData): Promise<CreateProfileState> {
  if (!isDevPreviewEnabled()) notFound();
  const parsed = schema.safeParse({ firstName: formData.get("firstName"), lastName: formData.get("lastName") });
  const firstName = parsed.success ? parsed.data.firstName : "";
  const lastName = parsed.success ? parsed.data.lastName : "";
  if (!parsed.success) return { error: "Fyll i förnamn och efternamn.", firstName, lastName };

  let userId: string;
  try {
    ({ userId } = await createPreviewProfile(getDb(), { firstName, lastName, demoData: isPreviewDemoData() }));
  } catch (e) {
    if (e instanceof ValidationError) return { error: e.message, firstName, lastName };
    throw e;
  }
  // Fiktivt GPS-testområde så att GPS-simuleringen fungerar direkt (bara i förhandsvisning, skriver aldrig över ett riktigt område).
  await ensureTestWorkArea(getDb(), { id: userId });
  (await cookies()).set(PREVIEW_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  // Vidare till det första valet (Admin eller Anställd), som vid riktig inloggning.
  redirect("/login");
}
