"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { markAllMineRead } from "@/server/services/notifications";

export async function markAllReadAction(): Promise<void> {
  const session = await requirePermission("notifications:read:own");
  await markAllMineRead(getDb(), session.user.id);
  revalidatePath("/", "layout");
}
