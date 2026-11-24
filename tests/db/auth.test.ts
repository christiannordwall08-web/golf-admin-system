import { beforeEach, describe, expect, it } from "vitest";
import { can } from "@/domain/roles";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "@/server/auth/constants";
import { authenticate } from "@/server/auth/login";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/server/auth/password";
import {
  createSession,
  hashToken,
  purgeExpiredSessions,
  revokeAllUserSessions,
  revokeSession,
  validateSession,
} from "@/server/auth/session-store";
import { TEST_PASSWORD, makeAdmin, makeEmployee, resetDb, testDb, testPasswordHash } from "./helpers";

const db = testDb();
const T0 = new Date("2026-11-24T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

/** Admin som också jobbar: ett konto med admin-åtkomst och anställning i både Golfshop och Bollplockare. */
async function makeAdminWhoWorks() {
  const admin = await makeAdmin(db, "Owe Ägare");
  await db.employee.create({ data: { userId: admin.id, firstName: "Owe", lastName: "Ägare", category: "GOLFSHOP", isTestData: true } });
  await db.employee.create({ data: { userId: admin.id, firstName: "Owe", lastName: "Ägare", category: "BOLLPLOCKARE", isTestData: true } });
  return admin;
}

beforeEach(async () => {
  await resetDb(db);
});

describe("lösenord", () => {
  it("hashar med Argon2id och verifierar", async () => {
    const hash = await hashPassword("ett långt lösenord 123");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("långt");
    expect(await verifyPassword(hash, "ett långt lösenord 123")).toBe(true);
    expect(await verifyPassword(hash, "fel lösenord 123456")).toBe(false);
  });

  it("verifierar aldrig mot en trasig hash (kastar inte)", async () => {
    expect(await verifyPassword("inte-en-hash", "x")).toBe(false);
  });

  it("kräver minst 12 tecken och variation", () => {
    expect(validatePasswordStrength("kort")).toMatch(/minst 12/);
    expect(validatePasswordStrength("aaaaaaaaaaaaaaaa")).toMatch(/enkelt/);
    expect(validatePasswordStrength("x".repeat(129))).toMatch(/högst 128/);
    expect(validatePasswordStrength("en bra lösenfras här")).toBeNull();
  });
});

describe("authenticate – grundkrav", () => {
  it("godkänner rätt uppgifter (e-post är skiftlägesokänslig) och nollställer räknaren", async () => {
    const admin = await makeAdmin(db);
    await db.user.update({ where: { id: admin.id }, data: { failedLoginCount: 3 } });

    const result = await authenticate(db, { email: `  ${admin.email.toUpperCase()} `, password: TEST_PASSWORD, audience: "ADMIN" }, T0);
    expect(result).toEqual({ ok: true, user: { id: admin.id, role: "ADMIN" }, context: "ADMIN" });

    const after = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastLoginAt?.toISOString()).toBe(T0.toISOString());
    expect(await db.auditLog.count({ where: { action: "LOGIN_SUCCESS", actorId: admin.id } })).toBe(1);
  });

  it("ger samma svar för okänd användare och fel lösenord", async () => {
    const admin = await makeAdmin(db);
    const unknown = await authenticate(db, { email: "finns-inte@test.example", password: "whatever-123456", audience: "ADMIN" }, T0);
    const wrong = await authenticate(db, { email: admin.email, password: "wrong-password-123", audience: "ADMIN" }, T0);
    expect(unknown).toEqual({ ok: false, reason: "INVALID" });
    expect(wrong).toEqual({ ok: false, reason: "INVALID" });
  });

  it("avvisar inaktiverade konton även med rätt lösenord", async () => {
    const admin = await makeAdmin(db);
    await db.user.update({ where: { id: admin.id }, data: { isActive: false } });
    expect(await authenticate(db, { email: admin.email, password: TEST_PASSWORD, audience: "ADMIN" }, T0)).toEqual({ ok: false, reason: "INVALID" });
  });

  it(`spärrar kontot i ${LOCKOUT_MINUTES} min efter ${MAX_FAILED_LOGINS} felaktiga försök – även rätt lösenord nekas`, async () => {
    const admin = await makeAdmin(db);
    const bad = { email: admin.email, password: "fel-lösenord-123", audience: "ADMIN" as const };
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) expect(await authenticate(db, bad, T0)).toEqual({ ok: false, reason: "INVALID" });
    expect(await authenticate(db, bad, T0)).toEqual({ ok: false, reason: "LOCKED" });

    const good = { email: admin.email, password: TEST_PASSWORD, audience: "ADMIN" as const };
    expect(await authenticate(db, good, minutes(5))).toEqual({ ok: false, reason: "LOCKED" });
    expect((await authenticate(db, good, minutes(LOCKOUT_MINUTES + 1))).ok).toBe(true);
    expect(await db.auditLog.count({ where: { action: "LOGIN_LOCKED" } })).toBe(1);
  });

  it("loggar aldrig lösenord eller angiven e-post i revisionsloggen", async () => {
    await authenticate(db, { email: "hemlig.person@test.example", password: "super-secret-pw-999", audience: "EMPLOYEE" }, T0);
    const logs = JSON.stringify(await db.auditLog.findMany());
    expect(logs).not.toContain("super-secret-pw-999");
    expect(logs).not.toContain("hemlig.person");
  });
});

describe("TVÅ INLOGGNINGAR: Admin och Anställd", () => {
  it("en anställd (inte admin) kan inte logga in via admininloggningen, men via anställdinloggningen", async () => {
    const { user } = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
    const asAdmin = await authenticate(db, { email: user!.email, password: TEST_PASSWORD, audience: "ADMIN" }, T0);
    expect(asAdmin).toEqual({ ok: false, reason: "WRONG_AUDIENCE" });
    const asEmployee = await authenticate(db, { email: user!.email, password: TEST_PASSWORD, audience: "EMPLOYEE" }, T0);
    expect(asEmployee).toEqual({ ok: true, user: { id: user!.id, role: "GOLFSHOP" }, context: "EMPLOYEE" });
    expect(await db.auditLog.count({ where: { action: "LOGIN_WRONG_AUDIENCE" } })).toBe(1);
  });

  it("en ren admin (utan anställning) kan inte logga in som anställd", async () => {
    const admin = await makeAdmin(db);
    expect(await authenticate(db, { email: admin.email, password: TEST_PASSWORD, audience: "EMPLOYEE" }, T0)).toEqual({ ok: false, reason: "WRONG_AUDIENCE" });
    expect((await authenticate(db, { email: admin.email, password: TEST_PASSWORD, audience: "ADMIN" }, T0)).ok).toBe(true);
  });

  it("en admin som också jobbar kan använda båda inloggningarna", async () => {
    const admin = await makeAdminWhoWorks();
    const creds = { email: admin.email, password: TEST_PASSWORD };
    expect((await authenticate(db, { ...creds, audience: "ADMIN" }, T0)).ok).toBe(true);
    expect((await authenticate(db, { ...creds, audience: "EMPLOYEE" }, T0)).ok).toBe(true);
  });

  it("fel inloggningstyp räknas inte som felaktigt lösenord (ingen spärr)", async () => {
    const { user } = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
    for (let i = 0; i < MAX_FAILED_LOGINS + 2; i++) {
      await authenticate(db, { email: user!.email, password: TEST_PASSWORD, audience: "ADMIN" }, T0);
    }
    expect((await authenticate(db, { email: user!.email, password: TEST_PASSWORD, audience: "EMPLOYEE" }, T0)).ok).toBe(true);
  });

  it("fel lösenord ger INVALID, inte WRONG_AUDIENCE (avslöjar inget utan rätt lösenord)", async () => {
    const { user } = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
    expect(await authenticate(db, { email: user!.email, password: "fel-lösenord-123", audience: "ADMIN" }, T0)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("anställd som är inaktiverad (ingen aktiv anställning) kan inte logga in som anställd", async () => {
    const { user, employee } = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
    await db.employee.update({ where: { id: employee.id }, data: { status: "INACTIVE" } });
    expect(await authenticate(db, { email: user!.email, password: TEST_PASSWORD, audience: "EMPLOYEE" }, T0)).toEqual({ ok: false, reason: "WRONG_AUDIENCE" });
  });

  it("sessionens behörighet följer inloggningstypen, även för samma konto (admin som jobbar)", async () => {
    const admin = await makeAdminWhoWorks();
    const adminSession = await validateSession(db, (await createSession(db, admin.id, "ADMIN", {}, T0)).token, minutes(1));
    const staffSession = await validateSession(db, (await createSession(db, admin.id, "EMPLOYEE", {}, T0)).token, minutes(1));

    expect(adminSession?.context).toBe("ADMIN");
    expect(adminSession?.user.actingRole).toBe("ADMIN");
    expect(can(adminSession!.user.actingRole, "payrates:read:all")).toBe(true);

    // Samma person, men inloggad som anställd: inga adminbehörigheter alls.
    expect(staffSession?.context).toBe("EMPLOYEE");
    expect(staffSession?.user.role).toBe("ADMIN"); // kontots åtkomstnivå
    expect(staffSession?.user.actingRole).toBe("GOLFSHOP"); // sessionens roll
    expect(can(staffSession!.user.actingRole, "payrates:read:all")).toBe(false);
    expect(can(staffSession!.user.actingRole, "employees:read:all")).toBe(false);
    expect(can(staffSession!.user.actingRole, "schedule:read:all")).toBe(false);
    expect(staffSession?.user.employments.map((e) => e.category)).toEqual(["GOLFSHOP", "BOLLPLOCKARE"]);
    expect(staffSession?.user.primaryCategory).toBe("GOLFSHOP");
  });

  it("en ADMIN-session upphör direkt om kontot inte längre är admin, och en EMPLOYEE-session om anställningen upphör", async () => {
    const admin = await makeAdminWhoWorks();
    const a = await createSession(db, admin.id, "ADMIN", {}, T0);
    const e = await createSession(db, admin.id, "EMPLOYEE", {}, T0);

    await db.employee.updateMany({ where: { userId: admin.id }, data: { status: "INACTIVE" } });
    expect(await validateSession(db, e.token, minutes(1))).toBeNull();
    expect(await validateSession(db, a.token, minutes(1))).not.toBeNull();

    await db.user.update({ where: { id: admin.id }, data: { role: "GOLFSHOP" } });
    expect(await validateSession(db, a.token, minutes(2))).toBeNull();
  });
});

describe("sessioner", () => {
  it("sparar bara en hash av token – aldrig själva token", async () => {
    const admin = await makeAdmin(db);
    const { token } = await createSession(db, admin.id, "ADMIN", {}, T0);
    const rows = await db.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashToken(token));
    expect(rows[0].id).not.toBe(token);
    expect(rows[0].context).toBe("ADMIN");
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bit i base64url
  });

  it("validerar giltig token och ger användare med roll och namn", async () => {
    const admin = await makeAdmin(db, "Anna Admin");
    const { token } = await createSession(db, admin.id, "ADMIN", {}, T0);
    const session = await validateSession(db, token, minutes(1));
    expect(session?.user).toMatchObject({ id: admin.id, role: "ADMIN", actingRole: "ADMIN", displayName: "Anna Admin", employments: [] });
  });

  it("personalens namn kommer från personalregistret, inte från User", async () => {
    const { user, employee } = await makeEmployee(db, { firstName: "Lisa", lastName: "Svensson" });
    const { token } = await createSession(db, user!.id, "EMPLOYEE", {}, T0);
    const session = await validateSession(db, token, minutes(1));
    expect(session?.user.displayName).toBe("Lisa Svensson");
    expect(session?.user.firstName).toBe("Lisa");
    expect(session?.user.employments).toEqual([{ id: employee.id, category: "GOLFSHOP" }]);
    expect(session?.user.role).toBe("GOLFSHOP");
    expect(session?.user.actingRole).toBe("GOLFSHOP");
  });

  it("avvisar okänd, tom och manipulerad token", async () => {
    const admin = await makeAdmin(db);
    const { token } = await createSession(db, admin.id, "ADMIN", {}, T0);
    expect(await validateSession(db, undefined, T0)).toBeNull();
    expect(await validateSession(db, "", T0)).toBeNull();
    expect(await validateSession(db, token + "x", T0)).toBeNull();
    expect(await validateSession(db, "A".repeat(43), T0)).toBeNull();
  });

  it("upphör efter absolut maxtid och efter inaktivitet, och raderas då", async () => {
    const admin = await makeAdmin(db);
    const a = await createSession(db, admin.id, "ADMIN", {}, T0);
    expect(await validateSession(db, a.token, new Date(T0.getTime() + SESSION_ABSOLUTE_MS + 1))).toBeNull();
    expect(await db.session.count()).toBe(0);

    const b = await createSession(db, admin.id, "ADMIN", {}, T0);
    expect(await validateSession(db, b.token, new Date(T0.getTime() + SESSION_IDLE_MS + 1))).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("aktivitet förlänger inaktivitetsgränsen men inte den absoluta", async () => {
    const admin = await makeAdmin(db);
    const { token } = await createSession(db, admin.id, "ADMIN", {}, T0);
    expect(await validateSession(db, token, new Date(T0.getTime() + 6 * 86_400_000))).not.toBeNull();
    expect(await validateSession(db, token, new Date(T0.getTime() + 12 * 86_400_000))).not.toBeNull();
    expect(await validateSession(db, token, new Date(T0.getTime() + 15 * 86_400_000))).toBeNull();
  });

  it("inaktiverad användare förlorar direkt sin session", async () => {
    const admin = await makeAdmin(db);
    const { token } = await createSession(db, admin.id, "ADMIN", {}, T0);
    await db.user.update({ where: { id: admin.id }, data: { isActive: false } });
    expect(await validateSession(db, token, minutes(1))).toBeNull();
  });

  it("utloggning och 'logga ut överallt' fungerar", async () => {
    const admin = await makeAdmin(db);
    const a = await createSession(db, admin.id, "ADMIN", {}, T0);
    const b = await createSession(db, admin.id, "ADMIN", {}, T0);
    await revokeSession(db, a.token);
    expect(await validateSession(db, a.token, minutes(1))).toBeNull();
    expect(await validateSession(db, b.token, minutes(1))).not.toBeNull();
    expect(await revokeAllUserSessions(db, admin.id)).toBe(1);
    expect(await validateSession(db, b.token, minutes(1))).toBeNull();
  });

  it("underhållsrensning tar bort utgångna sessioner men inte aktiva", async () => {
    const admin = await makeAdmin(db);
    await createSession(db, admin.id, "ADMIN", {}, new Date(T0.getTime() - 30 * 86_400_000));
    await createSession(db, admin.id, "ADMIN", {}, T0);
    expect(await purgeExpiredSessions(db, T0)).toBe(1);
    expect(await db.session.count()).toBe(1);
  });
});

void testPasswordHash;
