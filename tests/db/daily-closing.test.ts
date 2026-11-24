import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  getClosingForDate,
  getClosingsMonth,
  listMyClosings,
  markClosingReviewed,
  readClosingImage,
  submitDailyClosing,
} from "@/server/services/daily-closing";
import { listMyNotifications } from "@/server/services/notifications";
import { LocalFileStorage } from "@/server/storage/file-storage";
import { makeAdmin, makeEmployee, makeShift, resetDb, testDb } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-24T19:00:00Z"); // tisdag kväll, Stockholm
const jpeg = (n = 1) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, n, 0x10, 0x4a, 0x46, 0x49, 0x46]);

let storageDir: string;
let storage: LocalFileStorage;
beforeEach(async () => {
  await resetDb(db);
  storageDir = mkdtempSync(join(tmpdir(), "golf-closing-"));
  storage = new LocalFileStorage(storageDir);
});

const filesStored = () => readdirSync(storageDir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile()).length;

async function setup() {
  const adam = await makeAdmin(db, "Adam");
  const berit = await makeAdmin(db, "Berit");
  const cesar = await makeAdmin(db, "Cesar");
  await db.user.updateMany({ where: { id: { in: [adam.id, berit.id] } }, data: { receivesDailyClosings: true } });
  const ada = await makeEmployee(db, { firstName: "Ada", lastName: "Andersson" });
  const bo = await makeEmployee(db, { firstName: "Bo", lastName: "Berg" });
  const ball = await makeEmployee(db, { firstName: "Cia", lastName: "Boll", category: "BOLLPLOCKARE" });
  const as = (u: { id: string }, role: "ADMIN" | "GOLFSHOP" | "BOLLPLOCKARE") => ({ id: u.id, role });
  return { adam, berit, cesar, ada, bo, ball, as };
}

const submit = (s: Awaited<ReturnType<typeof setup>>, who = s.ada, over: Record<string, unknown> = {}) =>
  submitDailyClosing(db, storage, s.as(who.user!, "GOLFSHOP"), {
    workDate: "2026-11-24",
    dayTotalOre: 1_234_550,
    bytes: jpeg(),
    originalName: "IMG_0001.jpg",
    now: NOW,
    ...over,
  });

describe("skicka in dagsavslut", () => {
  it("sparar bilden i datummappen, metadata med vem och när, och notifierar Adam och Berit direkt", async () => {
    const s = await setup();
    const { id } = await submit(s, s.ada, { note: "Kassan stämde" });

    const row = await db.dailyClosing.findUniqueOrThrow({ where: { id }, include: { uploadedBy: true } });
    expect([row.uploadedBy.firstName, row.workDate.toISOString().slice(0, 10), row.dayTotalOre, row.mimeType, row.status, row.note]).toEqual([
      "Ada", "2026-11-24", 1_234_550, "image/jpeg", "SUBMITTED", "Kassan stämde",
    ]);
    expect(row.uploadedAt).toEqual(NOW);
    expect(row.storageKey).toMatch(/^dagsavslut\/2026\/11\/24\/dagsavslut-[a-f0-9-]+\.jpg$/);
    expect(filesStored()).toBe(1);
    expect(row.sha256).toHaveLength(64);

    for (const admin of [s.adam, s.berit]) {
      const n = await listMyNotifications(db, admin.id);
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ type: "DAILY_CLOSING_SUBMITTED", title: "Dagsavslut 2026-11-24 från Ada Andersson", linkPath: "/admin/dagsavslut?datum=2026-11-24" });
      expect(n[0].body).toContain("12");
    }
    expect(await listMyNotifications(db, s.cesar.id)).toHaveLength(0); // inte vald som mottagare
    expect(await listMyNotifications(db, s.ada.user!.id)).toHaveLength(0);
    expect(await db.auditLog.count({ where: { action: "DAILY_CLOSING_SUBMITTED", entityId: id } })).toBe(1);
  });

  it("endast personal i golfshopen: bollplockare och admin utan golfshop-anställning nekas", async () => {
    const s = await setup();
    await expect(submitDailyClosing(db, storage, s.as(s.ball.user!, "BOLLPLOCKARE"), { workDate: "2026-11-24", dayTotalOre: 100, bytes: jpeg(), now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitDailyClosing(db, storage, s.as(s.adam, "ADMIN"), { workDate: "2026-11-24", dayTotalOre: 100, bytes: jpeg(), now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    expect(filesStored()).toBe(0);
    expect(await db.dailyClosing.count()).toBe(0);
  });

  it("inaktiverad personal nekas", async () => {
    const s = await setup();
    await db.employee.update({ where: { id: s.ada.employee.id }, data: { status: "INACTIVE" } });
    await expect(submit(s)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("avvisar filer som inte är bilder, för stora filer, framtida datum och ogiltiga summor – utan att något sparas", async () => {
    const s = await setup();
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(submit(s, s.ada, { bytes: html, originalName: "bild.jpg" })).rejects.toThrow(/ingen bild/);
    await expect(submit(s, s.ada, { bytes: new Uint8Array() })).rejects.toBeInstanceOf(ValidationError);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    await expect(submit(s, s.ada, { bytes: big })).rejects.toThrow(/för stor/);
    await expect(submit(s, s.ada, { workDate: "2026-11-25" })).rejects.toThrow(/framåt/);
    await expect(submit(s, s.ada, { workDate: "2026-11-20" })).rejects.toThrow(/framåt|senaste/);
    for (const dayTotalOre of [-1, 1.5, 2_000_000_000, Number.NaN]) {
      await expect(submit(s, s.ada, { dayTotalOre })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(filesStored()).toBe(0);
    expect(await db.dailyClosing.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
  });

  it("samma bild kan inte skickas in två gånger för samma dag, men får skickas in igen en annan dag", async () => {
    const s = await setup();
    await submit(s);
    await expect(submit(s, s.bo)).rejects.toThrow(/redan skickats in/);
    await submit(s, s.bo, { workDate: "2026-11-23" });
    expect(await db.dailyClosing.count()).toBe(2);
    expect(filesStored()).toBe(2);
  });

  it("om databasen nekar tas den sparade filen bort (ingen föräldralös fil)", async () => {
    const s = await setup();
    // En CHECK i databasen (sizeBytes > 0 / dayTotalOre >= 0) stoppar inte detta här, så provocera fram felet med en notis-FK:
    await db.user.updateMany({ data: { receivesDailyClosings: false } });
    await db.$executeRawUnsafe(`ALTER TABLE "DailyClosing" ADD CONSTRAINT "tmp_fail" CHECK ("dayTotalOre" <> 777) NOT VALID`);
    try {
      await expect(submit(s, s.ada, { dayTotalOre: 777 })).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "DailyClosing" DROP CONSTRAINT "tmp_fail"`);
    }
    expect(filesStored()).toBe(0);
    expect(await db.dailyClosing.count()).toBe(0);
  });
});

describe("administratörens vy", () => {
  it("visar per dag vem som skickade in och när, med dagens summa = senast inskickade", async () => {
    const s = await setup();
    await submit(s, s.ada, { dayTotalOre: 100_000, bytes: jpeg(1), now: new Date("2026-11-24T18:00:00Z") });
    await submit(s, s.bo, { dayTotalOre: 150_000, bytes: jpeg(2), now: new Date("2026-11-24T19:30:00Z") });
    await submit(s, s.ada, { workDate: "2026-11-23", dayTotalOre: 90_000, bytes: jpeg(3), now: new Date("2026-11-23T19:00:00Z") });

    const m = await getClosingsMonth(db, s.as(s.berit, "ADMIN"), { year: 2026, month: 11, now: NOW });
    expect(m.days.map((d) => d.date)).toEqual(["2026-11-24", "2026-11-23"]);
    const day = m.days[0];
    expect(day.closings.map((c) => c.employeeName)).toEqual(["Bo Berg", "Ada Andersson"]); // senast först, namn på varje rad
    expect(day.dayTotalOre).toBe(150_000);
    expect(m.monthTotalOre).toBe(240_000);
    expect(m.newCount).toBe(3);
    expect(await getClosingForDate(db, s.as(s.berit, "ADMIN"), "2026-11-24")).toEqual({ dayTotalOre: 150_000, count: 2 });
    expect(await getClosingForDate(db, s.as(s.berit, "ADMIN"), "2026-11-22")).toBeNull();
  });

  it("gränsen mellan månader: ett avslut den 30:e/1:a hamnar i rätt månad", async () => {
    const s = await setup();
    await submit(s, s.ada, { workDate: "2026-11-01", bytes: jpeg(1), now: new Date("2026-11-02T10:00:00Z") });
    await submit(s, s.ada, { workDate: "2026-11-30", bytes: jpeg(2), now: new Date("2026-11-30T20:00:00Z") });
    await submit(s, s.ada, { workDate: "2026-12-01", bytes: jpeg(3), now: new Date("2026-12-01T20:00:00Z") });
    const nov = await getClosingsMonth(db, s.as(s.adam, "ADMIN"), { year: 2026, month: 11, now: NOW });
    const dec = await getClosingsMonth(db, s.as(s.adam, "ADMIN"), { year: 2026, month: 12, now: NOW });
    expect(nov.days.map((d) => d.date).sort()).toEqual(["2026-11-01", "2026-11-30"]);
    expect(dec.days.map((d) => d.date)).toEqual(["2026-12-01"]);
  });

  it("pekar ut passerade dagar med golfshop-pass men utan avslut", async () => {
    const s = await setup();
    const admin = await makeAdmin(db);
    for (const date of ["2026-11-20", "2026-11-23", "2026-11-24"]) {
      await makeShift(db, { employeeId: s.ada.employee.id, createdById: admin.id, date, from: "11:00", to: "15:00", publicationStatus: "PUBLISHED" });
    }
    await submit(s, s.ada, { workDate: "2026-11-23", now: new Date("2026-11-23T19:00:00Z") });
    const m = await getClosingsMonth(db, s.as(s.adam, "ADMIN"), { year: 2026, month: 11, now: NOW });
    expect(m.missingDates).toEqual(["2026-11-20"]); // 23:e har avslut, 24:e är idag (väntar), utkast räknas inte
  });

  it("personal får aldrig läsa andras avslut eller månadsvyn", async () => {
    const s = await setup();
    await expect(getClosingsMonth(db, s.as(s.ada.user!, "GOLFSHOP"), { year: 2026, month: 11 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getClosingForDate(db, s.as(s.ada.user!, "GOLFSHOP"), "2026-11-24")).rejects.toBeInstanceOf(ForbiddenError);
    await submit(s, s.ada);
    expect(await listMyClosings(db, s.ada.user!.id)).toHaveLength(1);
    expect(await listMyClosings(db, s.bo.user!.id)).toHaveLength(0); // bara egna
  });

  it("markera som granskad: bara Admin, syns med vem, och är idempotent", async () => {
    const s = await setup();
    const { id } = await submit(s);
    await expect(markClosingReviewed(db, s.as(s.ada.user!, "GOLFSHOP"), id)).rejects.toBeInstanceOf(ForbiddenError);
    await markClosingReviewed(db, s.as(s.berit, "ADMIN"), id, new Date("2026-11-25T08:00:00Z"));
    await markClosingReviewed(db, s.as(s.adam, "ADMIN"), id, new Date("2026-11-26T08:00:00Z")); // ändrar inte
    const row = (await getClosingsMonth(db, s.as(s.adam, "ADMIN"), { year: 2026, month: 11, now: NOW })).days[0].closings[0];
    expect([row.status, row.reviewedByName, row.reviewedAt]).toEqual(["REVIEWED", "Berit", new Date("2026-11-25T08:00:00Z")]);
    expect(await db.auditLog.count({ where: { action: "DAILY_CLOSING_REVIEWED" } })).toBe(1);
    await expect(markClosingReviewed(db, s.as(s.adam, "ADMIN"), "finns-inte")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("bilden", () => {
  it("kan ses av Admin och av den som skickade in den, men ingen annan", async () => {
    const s = await setup();
    const { id } = await submit(s);
    const asAdmin = await readClosingImage(db, storage, s.as(s.berit, "ADMIN"), id);
    expect(asAdmin.mimeType).toBe("image/jpeg");
    expect(asAdmin.filename).toBe("dagsavslut-2026-11-24.jpg");
    expect([...asAdmin.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect((await readClosingImage(db, storage, s.as(s.ada.user!, "GOLFSHOP"), id)).bytes.length).toBeGreaterThan(0);
    await expect(readClosingImage(db, storage, s.as(s.bo.user!, "GOLFSHOP"), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readClosingImage(db, storage, s.as(s.ball.user!, "BOLLPLOCKARE"), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readClosingImage(db, storage, s.as(s.berit, "ADMIN"), "finns-inte")).rejects.toBeInstanceOf(NotFoundError);
  });
});
