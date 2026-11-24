import { describe, expect, it } from "vitest";
import {
  USER_ROLES,
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
