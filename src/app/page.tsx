import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/domain/roles";
import { getSessionUser } from "@/server/auth/current-user";

/** Skickar inloggade till sin startsida och övriga till inloggningen. */
export default async function Home() {
  const session = await getSessionUser();
  redirect(session ? ROLE_HOME[session.user.role] : "/login");
}
