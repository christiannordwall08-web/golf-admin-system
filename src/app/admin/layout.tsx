import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NAV_BY_ROLE } from "@/components/layout/nav-config";
import { ROLE_LABEL } from "@/domain/roles";
import { requireRole } from "@/server/auth/current-user";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = await requireRole("ADMIN");
  return (
    <AppShell user={{ displayName: user.displayName, roleLabel: ROLE_LABEL[user.role], role: user.role }} nav={NAV_BY_ROLE.ADMIN}>
      {children}
    </AppShell>
  );
}
