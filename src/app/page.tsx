import { redirect } from "next/navigation";
import { getSessionUser, homeOf } from "@/server/auth/current-user";
import { isDevPreviewEnabled } from "@/server/dev-preview";

/** Inloggade till sin startsida, övriga till valet mellan Admin- och Anställd-inloggning. */
export default async function Home() {
  const session = await getSessionUser();
  if (session) redirect(homeOf(session));
  // Lokalt förhandsvisningsläge: ingen inloggning behövs.
  redirect(isDevPreviewEnabled() ? "/dev" : "/login");
}
