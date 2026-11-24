import { beforeEach, describe, expect, it } from "vitest";
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
import { TEST_PASSWORD, makeAdmin, makeEmployee, resetDb, testDb } from "./helpers";

const db = testDb();
const T0 = new Date("2026-11-24T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

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

describe("authenticate", () => {
  it("godkänner rätt uppgifter (e-post är skiftlägesokänslig) och nollställer räknaren", async () => {
    const admin = await makeAdmin(db);
    await db.user.update({ where: { id: admin.id }, data: { failedLoginCount: 3 } });

    const result = await authenticate(db, { email: `  ${admin.email.toUpperCase()} `, password: TEST_PASSWORD }, T0);
    expect(result).toEqual({ ok: true, user: { id: admin.id, role: "ADMIN" } });

    const after = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastLoginAt?.toISOString()).toBe(T0.toISOString());
    expect(await db.auditLog.count({ where: { action: "LOGIN_SUCCESS", actorId: admin.id } })).toBe(1);
  });

  it("ger samma svar för okänd användare och fel lösenord", async () => {
    const admin = await makeAdmin(db);
    const unknown = await authenticate(db, { email: "finns-inte@test.example", password: "whatever-123456" }, T0);
    const wrong = await authenticate(db, { email: admin.email, password: "wrong-password-123" }, T0);
    expect(unknown).toEqual({ ok: false, reason: "INVALID" });
    expect(wrong).toEqual({ ok: false, reason: "INVALID" });
  });

  it("avvisar inaktiverade konton även med rätt lösenord", async () => {
    const admin = await makeAdmin(db);
    await db.user.update({ where: { id: admin.id }, data: { isActive: false } });
    expect(await authenticate(db, { email: admin.email, password: TEST_PASSWORD }, T0)).toEqual({
      ok: false,
      reason: "INVALID",
    });
  });

  it(`spärrar kontot i ${LOCKOUT_MINUTES} min efter ${MAX_FAILED_LOGINS} felaktiga försök – även rätt lösenord nekas`, async () => {
    const admin = await makeAdmin(db);
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      const r = await authenticate(db, { email: admin.email, password: "fel-lösenord-123" }, T0);
      expect(r).toEqual({ ok: false, reason: "INVALID" });
    }
    const last = await authenticate(db, { email: admin.email, password: "fel-lösenord-123" }, T0);
    expect(last).toEqual({ ok: false, reason: "LOCKED" });

    // Rätt lösenord under spärren nekas
    expect(await authenticate(db, { email: admin.email, password: TEST_PASSWORD }, minutes(5))).toEqual({
      ok: false,
      reason: "LOCKED",
    });
    // Efter spärrtiden fungerar rätt lösenord igen och räknaren började om
    const later = await authenticate(db, { email: admin.email, password: TEST_PASSWORD }, minutes(LOCKOUT_MINUTES + 1));
    expect(later.ok).toBe(true);
    expect(await db.auditLog.count({ where: { action: "LOGIN_LOCKED" } })).toBe(1);
  });

  it("loggar aldrig lösenord eller angiven e-post i revisionsloggen", async () => {
    await authenticate(db, { email: "hemlig.person@test.example", password: "super-secret-pw-999" }, T0);
    const logs = JSON.stringify(await db.auditLog.findMany());
    expect(logs).not.toContain("super-secret-pw-999");
    expect(logs).not.toContain("hemlig.person");
  });
});

describe("sessioner", () => {
  it("sparar bara en hash av token – aldrig själva token", async () => {
    const admin = await makeAdmin(db);
    const { token } = await createSession(db, admin.id, {}, T0);
    const rows = await db.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashToken(token));
    expect(rows[0].id).not.toBe(token);
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bit i base64url
  });

  it("validerar giltig token och ger användare med roll och namn", async () => {
    const admin = await makeAdmin(db, "Anna Admin");
    const { token } = await createSession(db, admin.id, {}, T0);
    const session = await validateSession(db, token, minutes(1));
    expect(session?.user).toMatchObject({ id: admin.id, role: "ADMIN", displayName: "Anna Admin", employee: null });
  });

  it("personalens namn kommer från personalregistret, inte från User", async () => {
    const { user, employee } = await makeEmployee(db, { firstName: "Lisa", lastName: "Svensson" });
    const { token } = await createSession(db, user!.id, {}, T0);
    const session = await validateSession(db, token, minutes(1));
    expect(session?.user.displayName).toBe("Lisa Svensson");
    expect(session?.user.firstName).toBe("Lisa");
    expect(session?.user.employee).toEqual({ id: employee.id, category: "GOLFSHOP" });
    expect(session?.user.role).toBe("GOLFSHOP");
  });

  it("avvisar okänd, tom och manipulerad token", async () => {
    const admin = await makeAdmin(db);
    const { token } = await createSession(db, admin.id, {}, T0);
    expect(await validateSession(db, undefined, T0)).toBeNull();
    expect(await validateSession(db, "", T0)).toBeNull();
    expect(await validateSession(db, token + "x", T0)).toBeNull();
    expect(await validateSession(db, "A".repeat(43), T0)).toBeNull();
  });

  it("upphör efter absolut maxtid och efter inaktivitet, och raderas då", async () => {
    const admin = await makeAdmin(db);
    const a = await createSession(db, admin.id, {}, T0);
    expect(await validateSession(db, a.token, new Date(T0.getTime() + SESSION_ABSOLUTE_MS + 1))).toBeNull();
    expect(await db.session.count()).toBe(0);

    const b = await createSession(db, admin.id, {}, T0);
    expect(await validateSession(db, b.token, new Date(T0.getTime() + SESSION_IDLE_MS + 1))).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("aktivitet förlänger inaktivitetsgränsen men inte den absoluta", async () => {
    const admin = await makeAdmin(db);
    const { token } = await createSession(db, admin.id, {}, T0);
    const sixDays = new Date(T0.getTime() + 6 * 86_400_000);
    expect(await validateSession(db, token, sixDays)).not.toBeNull(); // uppdaterar lastSeenAt
    const twelveDays = new Date(T0.getTime() + 12 * 86_400_000);
    expect(await validateSession(db, token, twelveDays)).not.toBeNull(); // 6 dagar sedan senast
    const fifteenDays = new Date(T0.getTime() + 15 * 86_400_000);
    expect(await validateSession(db, token, fifteenDays)).toBeNull(); // absolut gräns (14 d)
  });

  it("inaktiverad användare förlorar direkt sin session", async () => {
    const admin = await makeAdmin(db);
    const { token } = await createSession(db, admin.id, {}, T0);
    await db.user.update({ where: { id: admin.id }, data: { isActive: false } });
    expect(await validateSession(db, token, minutes(1))).toBeNull();
  });

  it("utloggning och 'logga ut överallt' fungerar", async () => {
    const admin = await makeAdmin(db);
    const a = await createSession(db, admin.id, {}, T0);
    const b = await createSession(db, admin.id, {}, T0);
    await revokeSession(db, a.token);
    expect(await validateSession(db, a.token, minutes(1))).toBeNull();
    expect(await validateSession(db, b.token, minutes(1))).not.toBeNull();
    expect(await revokeAllUserSessions(db, admin.id)).toBe(1);
    expect(await validateSession(db, b.token, minutes(1))).toBeNull();
  });

  it("underhållsrensning tar bort utgångna sessioner men inte aktiva", async () => {
    const admin = await makeAdmin(db);
    await createSession(db, admin.id, {}, new Date(T0.getTime() - 30 * 86_400_000));
    await createSession(db, admin.id, {}, T0);
    expect(await purgeExpiredSessions(db, T0)).toBe(1);
    expect(await db.session.count()).toBe(1);
  });
});
