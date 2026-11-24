import { NotFoundError } from "@/server/errors";
import { getSessionUser, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { readClosingImage } from "@/server/services/daily-closing";
import { getStorage } from "@/server/storage/file-storage";

/**
 * Dagsavslutets bild. Aldrig en publik fil: kräver inloggning, och bara Admin och den som skickade in bilden får se den.
 * Svaret cachas inte av delade cacher, och webbläsaren får inte tolka innehållet som något annat än en bild.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return new Response("Unauthorized", { status: 401 });
  try {
    const image = await readClosingImage(getDb(), getStorage(), toActor(session), (await params).id);
    return new Response(Buffer.from(image.bytes), {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Disposition": `inline; filename="${image.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
