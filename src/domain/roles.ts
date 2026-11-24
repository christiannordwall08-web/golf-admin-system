/**
 * Roller, arbetskategorier och behörigheter. EN källa för alla åtkomstregler.
 * Serverkod ska alltid kontrollera behörighet med `can()`/`requirePermission()` –
 * att dölja en knapp i gränssnittet är aldrig skydd.
 */

export const USER_ROLES = ["ADMIN", "GOLFSHOP", "BOLLPLOCKARE"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const WORK_CATEGORIES = ["GOLFSHOP", "BOLLPLOCKARE"] as const;
export type WorkCategory = (typeof WORK_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<WorkCategory, string> = {
  GOLFSHOP: "Golfshop",
  BOLLPLOCKARE: "Bollplockare",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  GOLFSHOP: "Golfshop",
  BOLLPLOCKARE: "Bollplockare",
};

/** Startsida per roll. */
export const ROLE_HOME: Record<UserRole, string> = {
  ADMIN: "/admin",
  GOLFSHOP: "/golfshop",
  BOLLPLOCKARE: "/bollplockare",
};

/** Kategorin en personalroll hör till (ADMIN har ingen). */
export function categoryForRole(role: UserRole): WorkCategory | null {
  return role === "ADMIN" ? null : role;
}

/** Rollen en anställd i en kategori ska ha. */
export function roleForCategory(category: WorkCategory): UserRole {
  return category;
}

/** Invariant: en personalroll måste matcha anställds arbetskategori. */
export function isRoleConsistentWithCategory(role: UserRole, category: WorkCategory): boolean {
  return categoryForRole(role) === category;
}

/**
 * TVÅ INLOGGNINGAR. En session har alltid en `context`:
 *  - ADMIN:    admininloggningen. Kräver User.role === ADMIN. Ger adminpanelen och alla adminbehörigheter.
 *  - EMPLOYEE: anställdinloggningen. Kräver minst en aktiv anställning. Ger bara den egna panelen
 *              (Golfshop och/eller Bollplockare) och de egna personalbehörigheterna.
 * En person kan vara båda (t.ex. ägaren som också jobbar). Då avgör inloggningen som användes vad
 * sessionen får göra: i en anställdsession ser man aldrig andras löner, även om kontot också är admin.
 */
export const SESSION_CONTEXTS = ["ADMIN", "EMPLOYEE"] as const;
export type SessionContext = (typeof SESSION_CONTEXTS)[number];

export const CATEGORY_HOME: Record<WorkCategory, string> = {
  GOLFSHOP: "/golfshop",
  BOLLPLOCKARE: "/bollplockare",
};

/** Får användaren använda den här inloggningen? (`employmentCount` = antal aktiva anställningar.) */
export function canUseAudience(role: UserRole, audience: SessionContext, employmentCount: number): boolean {
  return audience === "ADMIN" ? role === "ADMIN" : employmentCount > 0;
}

/** Den roll vars behörigheter gäller i sessionen. Anställd ⇒ Golfshop om man har den, annars Bollplockare. */
export function actingRoleFor(context: SessionContext, categories: readonly WorkCategory[]): UserRole {
  if (context === "ADMIN") return "ADMIN";
  return categories.includes("GOLFSHOP") ? "GOLFSHOP" : "BOLLPLOCKARE";
}

/** Främsta arbetsplatsen: personalrollens egen kategori om den finns, annars Golfshop före Bollplockare. */
export function primaryCategory(role: UserRole, categories: readonly WorkCategory[]): WorkCategory | null {
  if (categories.length === 0) return null;
  const own = categoryForRole(role);
  if (own && categories.includes(own)) return own;
  return categories.includes("GOLFSHOP") ? "GOLFSHOP" : "BOLLPLOCKARE";
}

/** Startsida för en session. */
export function homeFor(context: SessionContext, primary: WorkCategory | null): string {
  if (context === "ADMIN") return "/admin";
  return primary ? CATEGORY_HOME[primary] : "/login";
}

/** Får en session med den här inloggningen skickas till `path` efter inloggning? */
export function isPathAllowedForContext(context: SessionContext, path: string): boolean {
  const starts = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
  return context === "ADMIN" ? starts("/admin") : starts("/golfshop") || starts("/bollplockare");
}

const ALL_PERMISSIONS = [
  // Personal
  "employees:read:all",
  "employees:write",
  // Lön (endast Admin)
  "payrates:read:all",
  "payrates:write",
  // Schema
  "schedule:read:all",
  "schedule:write",
  "schedule:publish",
  "shift:read:own",
  "shift:respond:own",
  // Passbyten
  "swap:request",
  "swap:read:all",
  "swap:decide",
  // Arbetstid och lön
  "worktime:read:own",
  "worktime:read:all",
  "worktime:approve",
  "worktime:correct",
  "payroll:read:all",
  "payroll:approve",
  // Dagsavslut
  "dailyclosing:submit",
  "dailyclosing:read:all",
  "dailyclosing:assign",
  // System
  "notifications:read:own",
  "audit:read",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const STAFF_COMMON: readonly Permission[] = [
  "shift:read:own",
  "shift:respond:own",
  "swap:request",
  "worktime:read:own",
  "notifications:read:own",
];

const PERMISSIONS_BY_ROLE: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>(ALL_PERMISSIONS),
  GOLFSHOP: new Set<Permission>([...STAFF_COMMON, "dailyclosing:submit"]),
  BOLLPLOCKARE: new Set<Permission>(STAFF_COMMON),
};

export function can(role: UserRole, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].has(permission);
}

export function permissionsOf(role: UserRole): readonly Permission[] {
  return [...PERMISSIONS_BY_ROLE[role]];
}

/** Returnerar `next` bara om det är en intern sökväg (skydd mot öppen omdirigering). */
export function safeInternalPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001F]/.test(next)) return fallback;
  return next;
}
