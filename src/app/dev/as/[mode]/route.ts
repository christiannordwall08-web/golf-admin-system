import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { PREVIEW_COOKIE, findPreviewProfile, isDevPreviewEnabled, modeFromSegment } from "@/server/dev-preview";
import { startPreviewSession } from "@/server/dev-preview-session";

/**
 * Förhandsvisning: loggar in testprofilen utan lösenord, som Admin eller som Anställd i en arbetsplats,
 * och skickar till rätt panel. Skapar en helt vanlig session med rätt inloggningstyp.
 * Finns bara i lokalt förhandsvisningsläge; annars 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ mode: string }> }) {
  if (!isDevPreviewEnabled()) return new Response("Not found", { status: 404 });

  const mode = modeFromSegment((await params).mode);
  if (!mode) return new Response("Not found", { status: 404 });

  const db = getDb();
  const profile = await findPreviewProfile(db, (await cookies()).get(PREVIEW_COOKIE)?.value);
  if (!profile) redirect("/dev");

  const target = await startPreviewSession(db, profile.id, mode);
  redirect(target ?? "/dev?saknas=1");
}
