"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CATEGORY_HOME } from "@/domain/roles";
import { requirePermission, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { claimOpenShift, withdrawClaim } from "@/server/services/open-shifts";

/**
 * Personalens åtgärder för lediga pass. Gemensamma för alla grupper (golfshop och bollplockare), så att en anställdsida
 * bara behöver visa <EmployeeOpenShiftsPage>. Kategorin kommer från formuläret men styr bara vart man skickas tillbaka:
 * tjänsten kontrollerar själv att den inloggade har en anställning i passets grupp.
 */
const input = z.object({
  id: z.string().min(1).max(64),
  category: z.enum(["GOLFSHOP", "BOLLPLOCKARE"]),
});

function back(category: "GOLFSHOP" | "BOLLPLOCKARE", query: string): never {
  const path = `${CATEGORY_HOME[category]}/lediga-pass`;
  revalidatePath(path);
  redirect(`${path}?${query}`);
}

export async function claimOpenShiftAction(formData: FormData): Promise<void> {
  const s = await requirePermission("openshift:claim");
  const { id, category } = input.parse({
    id: formData.get("id"),
    category: formData.get("category"),
  });
  let query: string;
  try {
    const r = await claimOpenShift(getDb(), toActor(s), id);
    query = r.assigned ? "klart=fick" : "klart=anmald";
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    query = `fel=${encodeURIComponent(e.message)}`;
  }
  back(category, query);
}

export async function withdrawClaimAction(formData: FormData): Promise<void> {
  const s = await requirePermission("openshift:claim");
  const { id, category } = input.parse({
    id: formData.get("id"),
    category: formData.get("category"),
  });
  let query = "klart=aterkallad";
  try {
    await withdrawClaim(getDb(), toActor(s), id);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    query = `fel=${encodeURIComponent(e.message)}`;
  }
  back(category, query);
}
