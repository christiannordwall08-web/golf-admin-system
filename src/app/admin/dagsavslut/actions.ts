"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { markClosingReviewed } from "@/server/services/daily-closing";

export async function markReviewedAction(formData: FormData): Promise<void> {
  const session = await requirePermission("dailyclosing:read:all");
  const id = z.string().min(1).max(60).safeParse(formData.get("id"));
  if (!id.success) return;
  await markClosingReviewed(getDb(), { id: session.user.id, role: session.user.actingRole }, id.data);
  revalidatePath("/admin/dagsavslut");
}
