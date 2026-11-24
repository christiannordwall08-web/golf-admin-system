"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_CLOSING_IMAGE_BYTES, parseDayTotal } from "@/domain/daily-closing";
import { requirePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError, UnauthenticatedError } from "@/server/errors";
import { submitDailyClosing } from "@/server/services/daily-closing";
import { getStorage } from "@/server/storage/file-storage";

/** Värdena skickas tillbaka vid fel så att inget som skrivits in går förlorat (bilden måste dock väljas om). */
export type ClosingFormState = {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Byts vid lyckad inskickning så att formuläret nollställs. */
  nonce?: string;
  values?: { workDate: string; total: string; note: string };
};

const formSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: z.string().max(40),
  note: z.string().max(500, "Kommentaren får vara högst 500 tecken.").default(""),
});

export async function submitClosingAction(_prev: ClosingFormState, formData: FormData): Promise<ClosingFormState> {
  const str = (k: string) => (typeof formData.get(k) === "string" ? (formData.get(k) as string) : "");
  const values = { workDate: str("workDate"), total: str("total"), note: str("note") };
  try {
    const session = await requirePermission("dailyclosing:submit");
    const parsed = formSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Kontrollera uppgifterna.", values };
    const photo = formData.get("photo");
    if (!(photo instanceof File) || photo.size === 0) return { error: "Ta en bild på dagsavslutet, eller välj en bild.", values };
    if (photo.size > MAX_CLOSING_IMAGE_BYTES) return { error: "Bilden är för stor (högst 10 MB).", values };
    const total = parseDayTotal(parsed.data.total);
    if (!total.ok) return { error: total.message, values };

    await submitDailyClosing(getDb(), getStorage(), { id: session.user.id, role: session.user.actingRole }, {
      workDate: parsed.data.workDate,
      dayTotalOre: total.ore,
      note: parsed.data.note,
      bytes: new Uint8Array(await photo.arrayBuffer()),
      originalName: photo.name,
    });
    revalidatePath("/golfshop/dagsavslut");
    revalidatePath("/anstalld");
    return { ok: true, message: "Dagsavslutet är skickat. Administratörerna har fått en notis.", nonce: crypto.randomUUID() };
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    if (e instanceof AppError) return { error: e.message, values };
    throw e;
  }
}
