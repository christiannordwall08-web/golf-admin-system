import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NAV_BY_ROLE } from "@/components/layout/nav-config";
import { ROLE_LABEL } from "@/domain/roles";
import { requireRole } from "@/server/auth/current-user";

export default async function GolfshopLayout({ children }: { children: ReactNode }) {
  const { user } = await requireRole("GOLFSHOP");
  return (
    <AppShell user={{ displayName: user.displayName, roleLabel: ROLE_LABEL[user.role] }} nav={NAV_BY_ROLE.GOLFSHOP}>
      {children}
    </AppShell>
  );
}
