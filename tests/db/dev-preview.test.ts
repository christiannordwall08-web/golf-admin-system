import { beforeEach, describe, expect, it } from "vitest";
import { findPreviewProfile } from "@/server/dev-preview";
import { createPreviewProfile } from "@/server/dev-preview-profile";
import { ValidationError } from "@/server/errors";
import { resetDb, testDb, testPasswordHash } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-24T11:00:00Z");

beforeEach(async () => {
  await resetDb(db);
});

describe("createPreviewProfile – ett konto med bara för- och efternamn", () => {
  it("skapar EN användare som är admin och anställd i både Golfshop och Bollplockare, allt som testdata", async () => {
    const { userId, name } = await createPreviewProfile(db, { firstName: "Kalle", lastName: "Testsson", now: NOW });
    expect(name).toBe("Kalle Testsson");

    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { employees: { include: { payRates: true } } } });
    expect(user.role).toBe("ADMIN");
    expect(user.isTestData).toBe(true);
    expect(user.email).toBe("kalle.testsson@demo.test");
    expect(user.employees.map((e) => e.category).sort()).toEqual(["BOLLPLOCKARE", "GOLFSHOP"]);
    expect(user.employees.every((e) => e.isTestData && e.firstName === "Kalle" && e.lastName === "Testsson")).toBe(true);

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
