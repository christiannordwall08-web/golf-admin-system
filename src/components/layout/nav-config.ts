import type { UserRole } from "@/domain/roles";

export type NavIcon =
  | "dashboard"
  | "users"
  | "calendar"
  | "swap"
  | "clock"
  | "report"
  | "camera"
  | "shop"
  | "pin"
  | "map"
  | "settings"
  | "user"
  /** Lediga pass. */
  | "open";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** true = funktionen finns inte ännu. Visas avstängd med "Snart" – aldrig som en fungerande länk. */
  soon?: boolean;
};

/**
 * Navigering per roll. Lägg bara till `soon: false` (utelämna) när sidan faktiskt finns.
 * Golfshop och Admin ägs av samma utvecklare; Bollplockare-menyn ägs av Bollplockare-utvecklaren
 * (sidorna delar tills vidare komponenter med Golfshop, se src/components/employee).
 */
/** Samlad anställdvy för den som jobbar på båda ställena. */
export const NAV_COMBINED: NavItem[] = [
  { href: "/anstalld", label: "Alla mina pass", icon: "dashboard" },
  { href: "/golfshop", label: "Golfshop", icon: "shop" },
  { href: "/bollplockare", label: "Bollplockare", icon: "pin" },
];

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  ADMIN: [
    { href: "/admin", label: "Översikt", icon: "dashboard" },
    { href: "/admin/personal", label: "Personal & löner", icon: "users" },
    { href: "/admin/schema", label: "Schema", icon: "calendar" },
    { href: "/admin/lediga-pass", label: "Lediga pass", icon: "open" },
    { href: "/admin/passbyten", label: "Passbyten", icon: "swap" },
    { href: "/admin/bollplockare", label: "Bollplockare (live)", icon: "pin" },
    { href: "/admin/bollplockare/omrade", label: "Karta & arbetsområde", icon: "map" },
    { href: "/admin/bollplockare/installningar", label: "Range & GPS-inställningar", icon: "settings" },
    { href: "/admin/rapporter", label: "Arbetstid & rapporter", icon: "report" },
    { href: "/admin/dagsavslut", label: "Dagsavslut", icon: "camera" },
  ],
  GOLFSHOP: [
    { href: "/golfshop", label: "Start", icon: "dashboard" },
    { href: "/golfshop/schema", label: "Mitt schema", icon: "calendar" },
    { href: "/golfshop/lediga-pass", label: "Lediga pass", icon: "open" },
    { href: "/golfshop/timmar", label: "Mina timmar", icon: "clock" },
    { href: "/golfshop/byten", label: "Passbyten", icon: "swap" },
    { href: "/golfshop/dagsavslut", label: "Dagsavslut", icon: "camera" },
  ],
  BOLLPLOCKARE: [
    { href: "/bollplockare", label: "Start", icon: "dashboard" },
    { href: "/bollplockare/schema", label: "Mitt schema", icon: "calendar" },
    { href: "/bollplockare/timmar", label: "Mina timmar", icon: "clock" },
    { href: "/bollplockare/byten", label: "Passbyten", icon: "swap" },
    { href: "/bollplockare/profil", label: "Min profil", icon: "user" },
  ],
};
