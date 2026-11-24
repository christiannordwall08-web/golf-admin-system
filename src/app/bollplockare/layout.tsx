// ÄGS AV BOLLPLOCKARE-UTVECKLAREN. Delar tills vidare komponenter med Golfshop (src/components/employee).
import type { ReactNode } from "react";
import { EmployeeAreaLayout } from "@/components/employee/area-layout";

export default async function Layout({ children }: { children: ReactNode }) {
  return <EmployeeAreaLayout category="BOLLPLOCKARE">{children}</EmployeeAreaLayout>;
}
