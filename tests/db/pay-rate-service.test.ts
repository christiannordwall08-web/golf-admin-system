import { beforeEach, describe, expect, it } from "vitest";
import { compensationOre } from "@/domain/money";
import { changeHourlyRate, getRateForWorkDate, listPayRateHistory } from "@/server/services/pay-rates";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { makeAdmin, makeEmployee, resetDb, testDb } from "./helpers";

const db = testDb();

async function setup() {
  const adminUser = await makeAdmin(db);
  const { user: erikUser, employee: erik } = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
  return {
    admin: { id: adminUser.id, role: "ADMIN" as const },
    erikActor: { id: erikUser!.id, role: "GOLFSHOP" as const },
    erik,
  };
}

beforeEach(async () => {
  await resetDb(db);
});

describe("Test 10: en vanlig anställd kan inte ändra timlön", () => {
  it("servern nekar och ingenting skrivs", async () => {
    const { erikActor, erik } = await setup();
    await expect(
      changeHourlyRate(db, erikActor, { employeeId: erik.id, hourlyRateOre: 99_900, effectiveFrom: "2026-11-01" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.payRate.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "PAYRATE_CHANGED" } })).toBe(0);
  });

  it("anställda kan inte heller läsa lönehistorik", async () => {
    const { erikActor, erik } = await setup();
    await expect(listPayRateHistory(db, erikActor, erik.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getRateForWorkDate(db, erikActor, erik.id, "2026-11-03")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Test 11: historisk timlön", () => {
  it("lönehöjning från 15 nov ändrar inte ersättningen för pass före 15 nov", async () => {
    const { admin, erik } = await setup();
    await changeHourlyRate(db, admin, { employeeId: erik.id, hourlyRateOre: 14_000, effectiveFrom: "2026-01-01", reason: "Startlön" });
    await changeHourlyRate(db, admin, { employeeId: erik.id, hourlyRateOre: 15_000, effectiveFrom: "2026-11-15", reason: "Höjning" });

    const history = await listPayRateHistory(db, admin, erik.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ hourlyRateOre: 14_000, validFrom: "2026-01-01", validTo: "2026-11-15" });
    expect(history[1]).toMatchObject({ hourlyRateOre: 15_000, validFrom: "2026-11-15", validTo: null });

    const early = (await getRateForWorkDate(db, admin, erik.id, "2026-11-03"))!;
    const late = (await getRateForWorkDate(db, admin, erik.id, "2026-11-20"))!;
    expect(compensationOre(240, early.hourlyRateOre)).toBe(56_000);
    expect(compensationOre(240, late.hourlyRateOre)).toBe(60_000);
  });

  it("varje ändring revisionsloggas med före/efter och vem", async () => {
    const { admin, erik } = await setup();
    await changeHourlyRate(db, admin, { employeeId: erik.id, hourlyRateOre: 14_000, effectiveFrom: "2026-01-01" });
    await changeHourlyRate(db, admin, { employeeId: erik.id, hourlyRateOre: 15_000, effectiveFrom: "2026-11-15", reason: "Höjning" });

    const logs = await db.auditLog.findMany({ where: { action: "PAYRATE_CHANGED" }, orderBy: { createdAt: "asc" } });
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatchObject({
      actorId: admin.id,
      entityId: erik.id,
      before: { hourlyRateOre: 14_000, validFrom: "2026-01-01" },
      after: { hourlyRateOre: 15_000, validFrom: "2026-11-15" },
    });
  });

  it("avvisar retroaktiv ändring och lämnar historiken orörd", async () => {
    const { admin, erik } = await setup();
    await changeHourlyRate(db, admin, { employeeId: erik.id, hourlyRateOre: 14_000, effectiveFrom: "2026-01-01" });
    await expect(
      changeHourlyRate(db, admin, { employeeId: erik.id, hourlyRateOre: 15_000, effectiveFrom: "2026-01-01" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await db.payRate.count()).toBe(1);
    expect((await db.payRate.findFirstOrThrow()).validTo).toBeNull();
  });

  it("transaktionen rullas tillbaka helt vid fel (ingen halvfärdig historik)", async () => {
    const { admin, erik } = await setup();
    await changeHourlyRate(db, admin, { employeeId: erik.id, hourlyRateOre: 14_000, effectiveFrom: "2026-01-01" });
    // Ogiltigt belopp avvisas innan något skrivs
    await expect(
      changeHourlyRate(db, admin, { employeeId: erik.id, hourlyRateOre: -5, effectiveFrom: "2026-06-01" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const [row] = await db.payRate.findMany();
    expect(row.validTo).toBeNull();
  });
});
