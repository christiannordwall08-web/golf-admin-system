import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NAV_COMBINED } from "@/components/layout/nav-config";
import { CATEGORY_HOME, CATEGORY_LABEL, COMBINED_HOME } from "@/domain/roles";
import { requireCombinedEmployeeArea } from "@/server/auth/current-user";

/** Samlad vy för den som jobbar både i golfshopen och som bollplockare. */
export default async function Layout({ children }: { children: ReactNode }) {
  const session = await requireCombinedEmployeeArea();
  const areaLinks = [
    ...session.user.employments.map((e) => ({ href: CATEGORY_HOME[e.category], label: CATEGORY_LABEL[e.category], current: false })),
    { href: COMBINED_HOME, label: "Båda", current: true },
  ];
  return (
    <AppShell
      user={{ displayName: session.user.displayName, roleLabel: "Anställd · Golfshop och Bollplockare" }}
      nav={NAV_COMBINED}
      previewCurrent="alla"
      areaLinks={areaLinks}
    >
      {children}
    </AppShell>
  );
}
