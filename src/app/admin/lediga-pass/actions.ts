"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError, UnauthenticatedError } from "@/server/errors";
import { assignOpenShift, cancelOpenShift, createOpenShift, updateSchedulingSettings } from "@/server/services/open-shifts";

/**
 * Server Actions för lediga pass (Admin). Behörighet kontrolleras här (requirePermission) OCH i tjänsten.
 * Indata valideras med Zod; affärsreglerna ligger i src/server/services/open-shifts.ts.
 */
export type OpenShiftFormState = {
  error?: string;
  values?: Record<string, string>;
};

const text = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());

const createSchema = z.object({
  category: z.enum(["GOLFSHOP", "BOLLPLOCKARE"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum."),
  from: z
    .string()
    .regex(/^(\d{2}:\d{2})?$/, "Ange starttid.")
    .default(""),
  to: z
    .string()
    .regex(/^(\d{2}:\d{2})?$/, "Ange sluttid.")
    .default(""),
  endsNextDay: checkbox,
  autoAssign: z.enum(["auto", "choose"]),
  notes: z.string().max(200, "Noteringen får vara högst 200 tecken.").default(""),
});

export async function createOpenShiftAction(_prev: OpenShiftFormState, formData: FormData): Promise<OpenShiftFormState> {
  const values = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const parsed = createSchema.safeParse(values);
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter.",
      values,
    };
  const d = parsed.data;
  if (d.category === "GOLFSHOP" && (!d.from || !d.to)) return { error: "Ange start- och sluttid.", values };
  let id: string;
  try {
    const s = await requirePermission("openshift:manage");
    const r = await createOpenShift(getDb(), toActor(s), {
      category: d.category,
      date: d.date,
      from: d.from,
      to: d.to,
      endsNextDay: d.endsNextDay,
      notes: d.notes,
      autoAssign: d.autoAssign === "auto",
    });
    if (!r.ok) return { error: r.issues.map((i) => i.message).join(" "), values };
    id = r.id;
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    if (e instanceof AppError) return { error: e.message, values };
    throw e;
  }
  revalidatePath("/admin/lediga-pass");
  redirect(`/admin/lediga-pass/${id}?klart=lagt-ut`);
}

export async function assignOpenShiftAction(formData: FormData): Promise<void> {
  const s = await requirePermission("openshift:manage");
  const id = text(formData, "id");
  let message = "";
  try {
    await assignOpenShift(getDb(), toActor(s), id, text(formData, "claimId"));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    message = e.message;
  }
  revalidatePath("/admin/lediga-pass");
  redirect(`/admin/lediga-pass/${id}${message ? `?fel=${encodeURIComponent(message)}` : "?klart=tillsatt"}`);
}

export async function cancelOpenShiftAction(formData: FormData): Promise<void> {
  const s = await requirePermission("openshift:manage");
  const id = text(formData, "id");
  let message = "";
  try {
    await cancelOpenShift(getDb(), toActor(s), id, text(formData, "reason"));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    message = e.message;
  }
  revalidatePath("/admin/lediga-pass");
  redirect(`/admin/lediga-pass/${id}${message ? `?fel=${encodeURIComponent(message)}` : "?klart=indraget"}`);
}

export async function updateSchedulingSettingsAction(formData: FormData): Promise<void> {
  const s = await requirePermission("settings:scheduling");
  const on = (k: string) => ["on", "true", "1"].includes(text(formData, k));
  await updateSchedulingSettings(getDb(), toActor(s), {
    autoApproveSwaps: on("autoApproveSwaps"),
    openShiftAutoAssignDefault: text(formData, "defaultMode") !== "choose",
  });
  revalidatePath("/admin/lediga-pass");
  redirect("/admin/lediga-pass?klart=installningar");
}
