import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkArea } from "@/modules/bollplockare/server/settings";
import { ensureTestWorkArea } from "@/modules/bollplockare/server/simulation";
import { findPreviewProfile } from "@/server/dev-preview";
import { createPreviewProfile } from "@/server/dev-preview-profile";
import { ValidationError } from "@/server/errors";
import { importSchedule } from "@/server/schedule-import";
import { resetDb, testDb, testPasswordHash } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-24T11:00:00Z");

beforeEach(async () => {
  await resetDb(db);
});

describe("createPreviewProfile – ett konto med bara för- och efternamn", () => {
  it("skapar EN användare som är admin och anställd i både Golfshop och Bollplockare, allt som testdata", async () => {
    const { userId, name } = await createPreviewProfile(db, { firstName: "Maja", lastName: "Exempel", now: NOW });
    expect(name).toBe("Maja Exempel");

    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { employees: { include: { payRates: true } } } });
    expect(user.role).toBe("ADMIN");
    expect(user.isTestData).toBe(true);
    expect(user.email).toBe("maja.exempel@demo.test");
    expect(user.employees.map((e) => e.category).sort()).toEqual(["BOLLPLOCKARE", "GOLFSHOP"]);
    expect(user.employees.every((e) => e.isTestData && e.firstName === "Maja" && e.lastName === "Exempel")).toBe(true);

    const rate = (c: string) => user.employees.find((e) => e.category === c)!.payRates[0].hourlyRateOre;
    expect(rate("GOLFSHOP")).toBe(15_000);
    expect(rate("BOLLPLOCKARE")).toBe(14_000);
  });

  it("ger schema i båda grupperna (genomförda och kommande pass) utan överlapp", async () => {
    const { userId } = await createPreviewProfile(db, { firstName: "Anna", lastName: "Test", now: NOW });
    for (const category of ["GOLFSHOP", "BOLLPLOCKARE"] as const) {
      const shifts = await db.shift.findMany({ where: { category, assignedEmployee: { userId } }, orderBy: { startsAt: "asc" } });
      expect(shifts.length).toBeGreaterThan(5);
      expect(shifts.some((s) => s.endsAt < NOW)).toBe(true);
      expect(shifts.some((s) => s.startsAt > NOW)).toBe(true);
      expect(shifts.every((s) => s.originalEmployeeId === s.assignedEmployeeId)).toBe(true);
    }
    expect(await db.auditLog.count({ where: { action: "DEV_PREVIEW_PROFILE_CREATED" } })).toBe(1);
  });

  it("samma namn två gånger ger unika e-postadresser", async () => {
    const a = await createPreviewProfile(db, { firstName: "Åke", lastName: "Öberg", now: NOW });
    const b = await createPreviewProfile(db, { firstName: "Åke", lastName: "Öberg", now: NOW });
    const emails = (await db.user.findMany({ where: { id: { in: [a.userId, b.userId] } }, orderBy: { createdAt: "asc" } })).map((u) => u.email);
    expect(emails).toEqual(["ake.oberg@demo.test", "ake.oberg.2@demo.test"]);
  });

  it("avvisar ogiltiga namn och skapar då ingenting", async () => {
    await expect(createPreviewProfile(db, { firstName: "", lastName: "Test", now: NOW })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPreviewProfile(db, { firstName: "Anna<b>", lastName: "Test", now: NOW })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.user.count()).toBe(0);
  });
});

describe("createPreviewProfile med egen (importerad) data", () => {
  const imported = {
    category: "GOLFSHOP" as const,
    employees: [{ firstName: "Anna", hourlyRateKr: 150, rateFrom: "2026-01-01" }],
    shifts: [
      { employee: "Anna", date: "2026-11-01", from: "11:00", to: "15:00" },
      { employee: "Anna", date: "2026-11-21", from: "11:00", to: "15:00" },
    ],
  };

  it("tar över en importerad anställning med samma förnamn i stället för att skapa en dubblett (behåller pass och lön)", async () => {
    await importSchedule(db, imported);
    const before = await db.employee.findFirstOrThrow({ where: { firstName: "Anna" }, include: { payRates: true } });

    const { userId, adopted } = await createPreviewProfile(db, { firstName: "anna", lastName: "Testsson", now: NOW, demoData: false });
    expect(adopted).toEqual({ golfshop: true, bollplockare: false });

    const all = await db.employee.findMany({ where: { category: "GOLFSHOP" } });
    expect(all).toHaveLength(1); // ingen dubblett
    const after = await db.employee.findUniqueOrThrow({ where: { id: before.id }, include: { payRates: true } });
    expect([after.userId, after.firstName, after.lastName]).toEqual([userId, "Anna", "Testsson"]); // förnamnets stavning behålls
    expect(after.payRates.map((p) => p.hourlyRateOre)).toEqual([15_000]);
    expect(await db.shift.count({ where: { assignedEmployeeId: before.id } })).toBe(2);
    expect(await db.shift.count()).toBe(2); // inga skenpass tillkom
  });

  it("utan skendata får nya anställningar varken påhittade pass eller påhittad lön", async () => {
    const { userId } = await createPreviewProfile(db, { firstName: "Ny", lastName: "Person", now: NOW, demoData: false });
    const employees = await db.employee.findMany({ where: { userId }, include: { payRates: true } });
    expect(employees.map((e) => e.category).sort()).toEqual(["BOLLPLOCKARE", "GOLFSHOP"]);
    expect(employees.every((e) => e.payRates.length === 0)).toBe(true);
    expect(await db.shift.count()).toBe(0);
  });

  it("tar inte över en anställning som redan har efternamn eller redan har ett konto", async () => {
    await db.employee.create({ data: { firstName: "Ny", lastName: "Annan", category: "GOLFSHOP", isTestData: true } });
    const { adopted } = await createPreviewProfile(db, { firstName: "Ny", lastName: "Person", now: NOW, demoData: false });
    expect(adopted.golfshop).toBe(false);
    expect(await db.employee.count({ where: { category: "GOLFSHOP" } })).toBe(2);
  });
});

describe("findPreviewProfile – hittar bara testprofiler, aldrig riktiga användare", () => {
  it("hittar den skapade profilen", async () => {
    const { userId } = await createPreviewProfile(db, { firstName: "Anna", lastName: "Test", now: NOW });
    expect(await findPreviewProfile(db, userId)).toEqual({ id: userId, name: "Anna Test" });
  });

  it("hittar INTE en riktig användare (isTestData = false) även om id:t är känt", async () => {
    const real = await db.user.create({ data: { email: "riktig@demo.test", passwordHash: await testPasswordHash(), role: "ADMIN", isTestData: false } });
    expect(await findPreviewProfile(db, real.id)).toBeNull();
  });

  it("hittar inte konton utanför testdomänen, inaktiva konton eller icke-admin", async () => {
    const hash = await testPasswordHash();
    const wrongDomain = await db.user.create({ data: { email: "x@riktigt-foretag.se", passwordHash: hash, role: "ADMIN", isTestData: true } });
    const inactive = await db.user.create({ data: { email: "i@demo.test", passwordHash: hash, role: "ADMIN", isTestData: true, isActive: false } });
    const staff = await db.user.create({ data: { email: "s@demo.test", passwordHash: hash, role: "GOLFSHOP", isTestData: true } });
    for (const u of [wrongDomain, inactive, staff]) expect(await findPreviewProfile(db, u.id)).toBeNull();
  });

  it("ger null utan id eller med okänt id", async () => {
    expect(await findPreviewProfile(db, undefined)).toBeNull();
    expect(await findPreviewProfile(db, "finns-inte")).toBeNull();
  });
});

describe("ensureTestWorkArea – fiktivt GPS-testområde, bara i förhandsvisning", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const enablePreview = () => {
    vi.stubEnv("DEV_PREVIEW", "1");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/golf_admin");
  };

  it("skapar ett testområde i förhandsvisning, och skriver aldrig över ett som redan finns", async () => {
    enablePreview();
    const { userId } = await createPreviewProfile(db, { firstName: "Maja", lastName: "Exempel", now: NOW });
    expect((await getWorkArea(db)).configured).toBe(false);

    expect(await ensureTestWorkArea(db, { id: userId })).toBe(true);
    const created = await getWorkArea(db);
    expect(created.configured).toBe(true);
    expect(created.marginMeters).toBe(40);

    expect(await ensureTestWorkArea(db, { id: userId })).toBe(false); // finns redan
    expect((await getWorkArea(db)).version).toBe(created.version);
  });

  it("gör ingenting utanför förhandsvisningsläget", async () => {
    vi.stubEnv("DEV_PREVIEW", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/golf_admin");
    const { userId } = await createPreviewProfile(db, { firstName: "Maja", lastName: "Exempel", now: NOW });
    expect(await ensureTestWorkArea(db, { id: userId })).toBe(false);
    expect((await getWorkArea(db)).configured).toBe(false);

    vi.stubEnv("DEV_PREVIEW", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await ensureTestWorkArea(db, { id: userId })).toBe(false);
    expect((await getWorkArea(db)).configured).toBe(false);
  });
});
