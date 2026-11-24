import type { Metadata } from "next";
import { NotificationsPage } from "@/components/notifications/notifications-page";
import { requireCombinedEmployeeArea } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Notiser" };

export default async function Page() {
  const session = await requireCombinedEmployeeArea();
  return <NotificationsPage userId={session.user.id} />;
}
