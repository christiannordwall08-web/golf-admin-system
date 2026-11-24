import { redirect } from "next/navigation";
import { isPathAllowedForContext } from "@/domain/roles";
import { getSessionUser, homeOf } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { openMyNotification } from "@/server/services/notifications";

/** Öppnar en notis: markerar den som läst och går till dess (interna) länk. Bara den egna notisen kan öppnas. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) redirect(`/login`);
  const opened = await openMyNotification(getDb(), session.user.id, (await params).id);
  if (!opened) return new Response("Not found", { status: 404 });
  const home = homeOf(session);
  // Länken måste höra till den här inloggningen (en adminnotis öppnad i en anställdsession går till startsidan).
  const target = opened.linkPath && isPathAllowedForContext(session.context, opened.linkPath) ? opened.linkPath : `${home}/notiser`;
  void request;
  redirect(target);
}
