// ÄGS AV BOLLPLOCKARE-UTVECKLAREN. Bara skalet finns här så att roller och inloggning kan
// verifieras. Ersätt gärna innehållet; behåll anropet till requireRole("BOLLPLOCKARE").
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NAV_BY_ROLE } from "@/components/layout/nav-config";
import { ROLE_LABEL } from "@/domain/roles";
import { requireRole } from "@/server/auth/current-user";

export default async function BollplockareLayout({ children }: { children: ReactNode }) {
  const { user } = await requireRole("BOLLPLOCKARE");
  return (
    <AppShell
      user={{ displayName: user.displayName, roleLabel: ROLE_LABEL[user.role] }}
      nav={NAV_BY_ROLE.BOLLPLOCKARE}
    >
      {children}
    </AppShell>
  );
}
