import type { UserRole } from "@/domain/roles";

export type NavIcon =
  | "dashboard"
  | "users"
  | "calendar"
  | "swap"
  | "clock"
  | "report"
  | "camera";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** true = funktionen finns inte ännu. Visas avstängd med "Snart" – aldrig som en fungerande länk. */
  soon?: boolean;
};

/**
 * Navigering per roll. Lägg bara till `soon: false` (utelämna) när sidan faktiskt finns.
 * Golfshop och Admin ägs av samma utvecklare; Bollplockare-menyn ägs av Bollplockare-utvecklaren.
 */
export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  ADMIN: [
    { href: "/admin", label: "Översikt", icon: "dashboard" },
    { href: "/admin/personal", label: "Personal", icon: "users", soon: true },
    { href: "/admin/schema", label: "Schema", icon: "calendar", soon: true },
    { href: "/admin/passbyten", label: "Passbyten", icon: "swap", soon: true },
    { href: "/admin/rapporter", label: "Arbetstid & rapporter", icon: "report", soon: true },
    { href: "/admin/dagsavslut", label: "Dagsavslut", icon: "camera", soon: true },
  ],
  GOLFSHOP: [
    { href: "/golfshop", label: "Start", icon: "dashboard" },
    { href: "/golfshop/schema", label: "Mitt schema", icon: "calendar", soon: true },
    { href: "/golfshop/timmar", label: "Mina timmar", icon: "clock", soon: true },
    { href: "/golfshop/byten", label: "Passbyten", icon: "swap", soon: true },
    { href: "/golfshop/dagsavslut", label: "Dagsavslut", icon: "camera", soon: true },
  ],
  BOLLPLOCKARE: [{ href: "/bollplockare", label: "Start", icon: "dashboard" }],
};
