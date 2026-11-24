import type { Metadata } from "next";
import { NotificationsPage } from "@/components/notifications/notifications-page";
import { requireEmployeeArea } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Notiser" };

export default async function Page() {
  const { session } = await requireEmployeeArea("GOLFSHOP");
  return <NotificationsPage userId={session.user.id} />;
}
