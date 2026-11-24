import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NAV_BY_ROLE } from "@/components/layout/nav-config";
import { requireAdminArea } from "@/server/auth/current-user";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminArea();
  return (
    <AppShell user={{ displayName: session.user.displayName, roleLabel: "Admin" }} nav={NAV_BY_ROLE.ADMIN} previewCurrent="admin">
      {children}
    </AppShell>
  );
}
