import { describe, expect, it } from "vitest";
import {
  USER_ROLES,
  categoriesForWorkplace,
  hasWorkplace,
  homeForWorkplace,
  workplaceFromSegment,
  actingRoleFor,
  canUseAudience,
  homeFor,
  isPathAllowedForContext,
  primaryCategory,
  can,
  categoryForRole,
  isRoleConsistentWithCategory,
  permissionsOf,
  roleForCategory,
  safeInternalPath,
} from "@/domain/roles";

describe("behörighetsmatris", () => {
  it("Test 10 (grund): endast ADMIN får ändra timlön, godkänna tid och läsa andras lön", () => {
    for (const role of USER_ROLES) {
      const isAdmin = role === "ADMIN";
      expect(can(role, "payrates:write")).toBe(isAdmin);
      expect(can(role, "payrates:read:all")).toBe(isAdmin);
      expect(can(role, "worktime:approve")).toBe(isAdmin);
      expect(can(role, "worktime:correct")).toBe(isAdmin);
      expect(can(role, "payroll:read:all")).toBe(isAdmin);
      expect(can(role, "payroll:approve")).toBe(isAdmin);
      expect(can(role, "schedule:publish")).toBe(isAdmin);
      expect(can(role, "swap:decide")).toBe(isAdmin);
      expect(can(role, "employees:write")).toBe(isAdmin);
    }
  });

  it("personal kan bara läsa sin egen information och föreslå ändringar", () => {
    for (const role of ["GOLFSHOP", "BOLLPLOCKARE"] as const) {
      expect(can(role, "shift:read:own")).toBe(true);
      expect(can(role, "shift:respond:own")).toBe(true);
      expect(can(role, "swap:request")).toBe(true);
      expect(can(role, "worktime:read:own")).toBe(true);
      expect(can(role, "schedule:read:all")).toBe(false);
      expect(can(role, "worktime:read:all")).toBe(false);
      expect(can(role, "employees:read:all")).toBe(false);
      expect(can(role, "audit:read")).toBe(false);
    }
  });

  it("dagsavslut: bara golfshop skickar in, bara admin läser alla", () => {
    expect(can("GOLFSHOP", "dailyclosing:submit")).toBe(true);
    expect(can("BOLLPLOCKARE", "dailyclosing:submit")).toBe(false);
    expect(can("GOLFSHOP", "dailyclosing:read:all")).toBe(false);
    expect(can("ADMIN", "dailyclosing:read:all")).toBe(true);
  });

  it("ADMIN har samtliga behörigheter", () => {
    expect(permissionsOf("ADMIN").length).toBeGreaterThan(permissionsOf("GOLFSHOP").length);
  });
});

describe("roll och arbetskategori", () => {
  it("personalroller matchar sin kategori, admin har ingen", () => {
    expect(categoryForRole("ADMIN")).toBeNull();
    expect(categoryForRole("GOLFSHOP")).toBe("GOLFSHOP");
    expect(roleForCategory("BOLLPLOCKARE")).toBe("BOLLPLOCKARE");
    expect(isRoleConsistentWithCategory("GOLFSHOP", "GOLFSHOP")).toBe(true);
    expect(isRoleConsistentWithCategory("GOLFSHOP", "BOLLPLOCKARE")).toBe(false);
    expect(isRoleConsistentWithCategory("ADMIN", "GOLFSHOP")).toBe(false);
  });
});

describe("safeInternalPath (skydd mot öppen omdirigering)", () => {
  it("släpper igenom interna sökvägar", () => {
    expect(safeInternalPath("/admin/personal?x=1", "/")).toBe("/admin/personal?x=1");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "admin", "", "/a\nb"])(
    "avvisar %j",
    (value) => {
      expect(safeInternalPath(value, "/fallback")).toBe("/fallback");
    },
  );
  it("null/undefined ger fallback", () => {
    expect(safeInternalPath(null, "/x")).toBe("/x");
    expect(safeInternalPath(undefined, "/x")).toBe("/x");
  });
});

describe("två inloggningar: Admin och Anställd", () => {
  it("admininloggning kräver rollen ADMIN, anställdinloggning kräver minst en anställning", () => {
    expect(canUseAudience("ADMIN", "ADMIN", 0)).toBe(true);
    expect(canUseAudience("GOLFSHOP", "ADMIN", 1)).toBe(false);
    expect(canUseAudience("BOLLPLOCKARE", "ADMIN", 1)).toBe(false);
    expect(canUseAudience("GOLFSHOP", "EMPLOYEE", 1)).toBe(true);
    expect(canUseAudience("ADMIN", "EMPLOYEE", 2)).toBe(true); // admin som också jobbar
    expect(canUseAudience("ADMIN", "EMPLOYEE", 0)).toBe(false); // ren admin har ingen anställd-panel
  });

  it("i en anställdsession gäller ALDRIG adminbehörigheter, även om kontot är admin", () => {
    const role = actingRoleFor("EMPLOYEE", ["GOLFSHOP", "BOLLPLOCKARE"]);
    expect(role).toBe("GOLFSHOP");
    expect(can(role, "payrates:read:all")).toBe(false);
    expect(can(role, "employees:read:all")).toBe(false);
    expect(can(role, "schedule:read:all")).toBe(false);
    expect(actingRoleFor("EMPLOYEE", ["BOLLPLOCKARE"])).toBe("BOLLPLOCKARE");
    expect(actingRoleFor("ADMIN", [])).toBe("ADMIN");
  });

  it("främsta arbetsplats och startsida", () => {
    expect(primaryCategory("GOLFSHOP", ["BOLLPLOCKARE", "GOLFSHOP"])).toBe("GOLFSHOP");
    expect(primaryCategory("BOLLPLOCKARE", ["GOLFSHOP", "BOLLPLOCKARE"])).toBe("BOLLPLOCKARE");
    expect(primaryCategory("ADMIN", ["BOLLPLOCKARE", "GOLFSHOP"])).toBe("GOLFSHOP");
    expect(primaryCategory("ADMIN", ["BOLLPLOCKARE"])).toBe("BOLLPLOCKARE");
    expect(primaryCategory("ADMIN", [])).toBeNull();
    expect(homeFor("ADMIN", null)).toBe("/admin");
    expect(homeFor("EMPLOYEE", "GOLFSHOP")).toBe("/golfshop");
    expect(homeFor("EMPLOYEE", "BOLLPLOCKARE")).toBe("/bollplockare");
    expect(homeFor("EMPLOYEE", null)).toBe("/login");
  });

  it("efter inloggning får man bara skickas till sidor som hör till inloggningen", () => {
    expect(isPathAllowedForContext("ADMIN", "/admin/personal?m=2026-11")).toBe(true);
    expect(isPathAllowedForContext("ADMIN", "/golfshop")).toBe(false);
    expect(isPathAllowedForContext("ADMIN", "/administrator")).toBe(false);
    expect(isPathAllowedForContext("EMPLOYEE", "/golfshop/schema")).toBe(true);
    expect(isPathAllowedForContext("EMPLOYEE", "/bollplockare")).toBe(true);
    expect(isPathAllowedForContext("EMPLOYEE", "/admin")).toBe(false);
  });
});

describe("arbetsplatsval vid anställd-inloggning", () => {
  it("tolkar bara golfshop, bollplockare och bada", () => {
    expect(workplaceFromSegment("Golfshop")).toBe("golfshop");
    expect(workplaceFromSegment("bada")).toBe("bada");
    expect(workplaceFromSegment("admin")).toBeNull();
    expect(workplaceFromSegment("")).toBeNull();
    expect(workplaceFromSegment(undefined)).toBeNull();
  });

  it("'Båda' kräver båda anställningarna, de andra valen en var", () => {
    expect(categoriesForWorkplace("bada")).toEqual(["GOLFSHOP", "BOLLPLOCKARE"]);
    expect(hasWorkplace(["GOLFSHOP"], "golfshop")).toBe(true);
    expect(hasWorkplace(["GOLFSHOP"], "bollplockare")).toBe(false);
    expect(hasWorkplace(["GOLFSHOP"], "bada")).toBe(false);
    expect(hasWorkplace(["GOLFSHOP", "BOLLPLOCKARE"], "bada")).toBe(true);
    expect(hasWorkplace([], "golfshop")).toBe(false);
  });

  it("startsida per val, och /anstalld är tillåten bara i anställdsession", () => {
    expect(homeForWorkplace("golfshop")).toBe("/golfshop");
    expect(homeForWorkplace("bollplockare")).toBe("/bollplockare");
    expect(homeForWorkplace("bada")).toBe("/anstalld");
    expect(isPathAllowedForContext("EMPLOYEE", "/anstalld?m=2026-11")).toBe(true);
    expect(isPathAllowedForContext("ADMIN", "/anstalld")).toBe(false);
    expect(isPathAllowedForContext("EMPLOYEE", "/anstalldx")).toBe(false);
  });
});
