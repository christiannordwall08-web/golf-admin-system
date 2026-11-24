"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { WorkCategory } from "@/domain/roles";
import { requirePermission, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError, UnauthenticatedError } from "@/server/errors";
import { cancelSwapRequest, createSwapRequest, decideSwap, postSwapMessage, respondToSwap } from "@/server/services/swaps";

/** Server Actions för passbyten. Behörighet och regler kontrolleras i tjänsten; här översätts bara fel till meddelanden. */
export type SwapFormState = { error?: string };

const area = (c: WorkCategory) => (c === "BOLLPLOCKARE" ? "bollplockare" : "golfshop");
const text = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

function fail(e: unknown): SwapFormState {
  if (e instanceof UnauthenticatedError) redirect("/login");
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

const createSchema = z.object({
  shiftId: z.string().min(1, "Välj ett pass."),
  kind: z.enum(["DIRECT", "OPEN", "EXCHANGE", "CHANGE"]),
  reason: z.string().trim().min(3, "Skriv en kort anledning.").max(500),
  proposedEmployeeId: z.string().optional(),
  counterShiftId: z.string().optional(),
  category: z.enum(["GOLFSHOP", "BOLLPLOCKARE"]),
});

export async function createSwapAction(_prev: SwapFormState, formData: FormData): Promise<SwapFormState> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter." };
  const d = parsed.data;
  let id: string;
  try {
    const s = await requirePermission("swap:request");
    ({ id } = await createSwapRequest(getDb(), toActor(s), {
      shiftId: d.shiftId,
      kind: d.kind,
      reason: d.reason,
      proposedEmployeeId: d.kind === "DIRECT" ? d.proposedEmployeeId || null : null,
      counterShiftId: d.kind === "EXCHANGE" ? d.counterShiftId || null : null,
    }));
  } catch (e) {
    return fail(e);
  }
  redirect(`/${area(d.category)}/byten/${id}`);
}

export async function respondSwapAction(formData: FormData): Promise<void> {
  const s = await requirePermission("swap:request");
  const id = text(formData, "id");
  const category = text(formData, "category") as WorkCategory;
  await respondToSwap(getDb(), toActor(s), id, { accept: text(formData, "decision") === "accept", comment: text(formData, "comment") || null }).catch((e) => {
    if (!(e instanceof AppError)) throw e;
  });
  revalidatePath(`/${area(category)}/byten`);
  redirect(`/${area(category)}/byten/${id}`);
}

export async function cancelSwapAction(formData: FormData): Promise<void> {
  const s = await requirePermission("swap:request");
  const id = text(formData, "id");
  const category = text(formData, "category") as WorkCategory;
  await cancelSwapRequest(getDb(), toActor(s), id).catch((e) => {
    if (!(e instanceof AppError)) throw e;
  });
  redirect(`/${area(category)}/byten`);
}

export async function messageSwapAction(formData: FormData): Promise<void> {
  const s = await requirePermission("notifications:read:own");
  const id = text(formData, "id");
  const back = text(formData, "back");
  await postSwapMessage(getDb(), toActor(s), id, text(formData, "body")).catch((e) => {
    if (!(e instanceof AppError)) throw e;
  });
  revalidatePath(back);
  redirect(back);
}

export async function decideSwapAction(formData: FormData): Promise<void> {
  const s = await requirePermission("swap:decide");
  const id = text(formData, "id");
  const approve = text(formData, "decision") === "approve";
  let message = "";
  try {
    await decideSwap(getDb(), toActor(s), id, { approve, comment: text(formData, "comment") || null });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    message = e.message;
  }
  revalidatePath("/admin/passbyten");
  redirect(`/admin/passbyten/${id}${message ? `?fel=${encodeURIComponent(message)}` : "?klart=1"}`);
}
