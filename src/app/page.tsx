import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, homeOf } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { PREVIEW_COOKIE, findPreviewProfile, isDevPreviewEnabled } from "@/server/dev-preview";

/**
 * Inloggade till sin startsida, övriga till det första valet: Admin eller Anställd.
 * Lokalt förhandsvisningsläge utan testkonto börjar med att skapa ett (på /dev); därefter visas samma val.
 */
export default async function Home() {
  const session = await getSessionUser();
  if (session) redirect(homeOf(session));
  if (isDevPreviewEnabled() && !(await findPreviewProfile(getDb(), (await cookies()).get(PREVIEW_COOKIE)?.value))) redirect("/dev");
  redirect("/login");
}
