import { beforeEach, describe, expect, it } from "vitest";
import { PREVIEW_ACCOUNTS, findPreviewUser } from "@/server/dev-preview";
import { resetDb, testDb, testPasswordHash } from "./helpers";

const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

describe("findPreviewUser – kan bara hitta testkonton, aldrig riktiga användare", () => {
  it("hittar testkontot för rätt roll", async () => {
    const user = await db.user.create({
      data: { email: PREVIEW_ACCOUNTS.ADMIN, passwordHash: await testPasswordHash(), role: "ADMIN", isTestData: true },
    });
    expect(await findPreviewUser(db, "ADMIN")).toEqual({ id: user.id, role: "ADMIN" });
  });

  it("hittar INTE en riktig användare (isTestData = false) med samma e-post", async () => {
    await db.user.create({
      data: { email: PREVIEW_ACCOUNTS.ADMIN, passwordHash: await testPasswordHash(), role: "ADMIN", isTestData: false },
    });
    expect(await findPreviewUser(db, "ADMIN")).toBeNull();
  });

  it("hittar inte inaktiverade konton eller konton med fel roll", async () => {
    await db.user.create({
      data: { email: PREVIEW_ACCOUNTS.GOLFSHOP, passwordHash: await testPasswordHash(), role: "GOLFSHOP", isTestData: true, isActive: false },
    });
    expect(await findPreviewUser(db, "GOLFSHOP")).toBeNull();

    await db.user.create({
      data: { email: PREVIEW_ACCOUNTS.BOLLPLOCKARE, passwordHash: await testPasswordHash(), role: "GOLFSHOP", isTestData: true },
    });
    expect(await findPreviewUser(db, "BOLLPLOCKARE")).toBeNull();
  });

  it("ger null när testdata saknas", async () => {
    expect(await findPreviewUser(db, "ADMIN")).toBeNull();
  });
});
