import { beforeEach, describe, expect, it } from "vitest";
import {
  adminUserIds,
  closingRecipientIds,
  countMyUnread,
  internalLinkOrNull,
  listMyNotifications,
  markAllMineRead,
  notify,
  openMyNotification,
} from "@/server/services/notifications";
import { makeAdmin, makeEmployee, resetDb, testDb } from "./helpers";

const db = testDb();
beforeEach(async () => {
  await resetDb(db);
});

describe("notiser", () => {
  it("skapar en notis per mottagare (utan dubbletter) och räknar olästa bara för mottagaren", async () => {
    const a = await makeEmployee(db, { firstName: "Ada", lastName: "A" });
    const b = await makeEmployee(db, { firstName: "Bo", lastName: "B" });
    const n = await notify(db, { userIds: [a.user!.id, a.user!.id], type: "SWAP_REQUESTED", title: "Ny förfrågan", linkPath: "/golfshop/byten" });
    expect(n).toBe(1);
    expect(await countMyUnread(db, a.user!.id)).toBe(1);
    expect(await countMyUnread(db, b.user!.id)).toBe(0);
    expect(await notify(db, { userIds: [], type: "SWAP_REQUESTED", title: "x" })).toBe(0);
  });

  it("sparar aldrig en extern eller otillåten länk (skydd mot öppen omdirigering)", async () => {
    expect(internalLinkOrNull("/golfshop/byten?x=1")).toBe("/golfshop/byten?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "\\\\evil", "javascript:alert(1)", "/ok\nbad", "", null, undefined]) {
      expect(internalLinkOrNull(bad as string | null)).toBeNull();
    }
    const a = await makeEmployee(db, { firstName: "Ada", lastName: "A" });
    await notify(db, { userIds: [a.user!.id], type: "SWAP_APPROVED", title: "t", linkPath: "https://evil.example" });
    expect((await listMyNotifications(db, a.user!.id))[0].linkPath).toBeNull();
  });

  it("en notis kan bara öppnas och markeras av sin ägare", async () => {
    const a = await makeEmployee(db, { firstName: "Ada", lastName: "A" });
    const b = await makeEmployee(db, { firstName: "Bo", lastName: "B" });
    await notify(db, { userIds: [a.user!.id], type: "SWAP_APPROVED", title: "Till Ada", linkPath: "/golfshop/byten/1" });
    const id = (await listMyNotifications(db, a.user!.id))[0].id;

    expect(await openMyNotification(db, b.user!.id, id)).toBeNull(); // någon annan
    expect(await countMyUnread(db, a.user!.id)).toBe(1); // orörd
    expect(await listMyNotifications(db, b.user!.id)).toHaveLength(0);

    expect(await openMyNotification(db, a.user!.id, id)).toEqual({ linkPath: "/golfshop/byten/1" });
    expect(await countMyUnread(db, a.user!.id)).toBe(0);
  });

  it("'markera alla som lästa' rör bara den egna användarens notiser", async () => {
    const a = await makeEmployee(db, { firstName: "Ada", lastName: "A" });
    const b = await makeEmployee(db, { firstName: "Bo", lastName: "B" });
    await notify(db, { userIds: [a.user!.id, b.user!.id], type: "SCHEDULE_PUBLISHED", title: "Schema" });
    expect(await markAllMineRead(db, a.user!.id)).toBe(1);
    expect(await countMyUnread(db, a.user!.id)).toBe(0);
    expect(await countMyUnread(db, b.user!.id)).toBe(1);
  });

  it("dagsavslut går till valda administratörer, och till alla administratörer om ingen valts", async () => {
    const adam = await makeAdmin(db, "Adam");
    const berit = await makeAdmin(db, "Berit");
    const cesar = await makeAdmin(db, "Cesar");
    await makeEmployee(db, { firstName: "Ada", lastName: "A" }); // personal, aldrig mottagare
    expect((await closingRecipientIds(db)).sort()).toEqual([adam.id, berit.id, cesar.id].sort()); // ingen vald

    await db.user.updateMany({ where: { id: { in: [adam.id, berit.id] } }, data: { receivesDailyClosings: true } });
    expect((await closingRecipientIds(db)).sort()).toEqual([adam.id, berit.id].sort());
    expect((await adminUserIds(db)).sort()).toEqual([adam.id, berit.id, cesar.id].sort());

    await db.user.update({ where: { id: adam.id }, data: { isActive: false } });
    expect(await closingRecipientIds(db)).toEqual([berit.id]); // inaktiva får inget
  });
});
