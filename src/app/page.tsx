import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/domain/roles";
import { getSessionUser } from "@/server/auth/current-user";
import { isDevPreviewEnabled } from "@/server/dev-preview";

/** Skickar inloggade till sin startsida och övriga till inloggningen. */
export default async function Home() {
  const session = await getSessionUser();
  if (session) redirect(ROLE_HOME[session.user.role]);
  // Lokalt förhandsvisningsläge: ingen inloggning, gå direkt in som Admin.
  redirect(isDevPreviewEnabled() ? "/dev/as/admin" : "/login");
}
