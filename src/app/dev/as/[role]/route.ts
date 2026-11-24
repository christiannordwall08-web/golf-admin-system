import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/domain/roles";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { createSession, revokeSession } from "@/server/auth/session-store";
import { getDb } from "@/server/db";
import { findPreviewUser, isDevPreviewEnabled, roleFromSegment } from "@/server/dev-preview";

/**
 * Förhandsvisning: loggar in som rollens TESTKONTO utan lösenord och skickar till rollens startsida.
 * Finns bara i lokalt förhandsvisningsläge; annars 404. Skapar en helt vanlig session.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ role: string }> }) {
  if (!isDevPreviewEnabled()) return new Response("Not found", { status: 404 });

  const role = roleFromSegment((await params).role);
  if (!role) return new Response("Not found", { status: 404 });

  const db = getDb();
  const user = await findPreviewUser(db, role);
  if (!user) redirect("/dev?saknas=1");

  // Byt konto rent: avsluta eventuell tidigare session innan den nya skapas.
  await revokeSession(db, await readSessionToken());
  await clearSessionCookie();
  const { token, expiresAt } = await createSession(db, user.id, { userAgent: "dev-preview" });
  await setSessionCookie(token, expiresAt);

  redirect(ROLE_HOME[user.role]);
}
