import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NAV_BY_ROLE } from "@/components/layout/nav-config";
import { CATEGORY_HOME, CATEGORY_LABEL, type WorkCategory } from "@/domain/roles";
import { requireEmployeeArea } from "@/server/auth/current-user";

/**
 * Gemensam layout för anställdpanelerna. Kräver en ANSTÄLLD-session med en aktiv anställning i
 * just den här kategorin. Har personen flera arbetsplatser visas en växlare.
 */
export async function EmployeeAreaLayout({ category, children }: { category: WorkCategory; children: ReactNode }) {
  const { session } = await requireEmployeeArea(category);
  const areaLinks = session.user.employments.map((e) => ({
    href: CATEGORY_HOME[e.category],
    label: CATEGORY_LABEL[e.category],
    current: e.category === category,
  }));
  return (
    <AppShell
      user={{ displayName: session.user.displayName, roleLabel: `Anställd · ${CATEGORY_LABEL[category]}` }}
      nav={NAV_BY_ROLE[category]}
      previewCurrent={category === "GOLFSHOP" ? "golfshop" : "bollplockare"}
      areaLinks={areaLinks}
    >
      {children}
    </AppShell>
  );
}
