import { beforeEach, describe, expect, it } from "vitest";
import { makeAdmin, makeEmployee, makeShift, resetDb, testDb } from "./helpers";

/**
 * Bevisar att tidpunkter lagras EXAKT rätt i databasen, mätt med ren SQL (inte via Prisma-rundtur, som
 * kan dölja ett fel som slår lika åt båda håll). Testdatabasen har medvetet standardtidszonen
 * Europe/Stockholm, så testet faller om appen skulle bero på databasens tidszon.
 */
const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

describe("tidslagring", () => {
  it("anslutningen använder UTC trots att databasens standardtidszon är en annan", async () => {
    const [{ TimeZone }] = await db.$queryRaw<{ TimeZone: string }[]>`SHOW TimeZone`;
    expect(TimeZone).toBe("UTC");
  });

  it.each([
    ["vintertid", "2026-11-28", "11:00", "2026-11-28T10:00:00Z"],
    ["sommartid", "2026-07-01", "11:00", "2026-07-01T09:00:00Z"],
    ["natt över midnatt (UTC+1)", "2026-11-30", "23:30", "2026-11-30T22:30:00Z"],
  ])("ett pass kl %s lagras som rätt ögonblick (verifierat med SQL)", async (_label, date, from, expectedUtc) => {
    const admin = await makeAdmin(db);
    const { employee } = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
    const shift = await makeShift(db, { employeeId: employee.id, createdById: admin.id, date, from, to: "23:59" });
    const [row] = await db.$queryRaw<{ ms: number }[]>`SELECT (EXTRACT(EPOCH FROM "startsAt") * 1000)::float8 AS ms FROM "Shift" WHERE id = ${shift.id}`;
    expect(row.ms).toBe(Date.parse(expectedUtc));
  });

  it("tidpunkter som databasen själv sätter (now()) läses tillbaka rätt, inte förskjutna", async () => {
    const admin = await makeAdmin(db);
    const note = await db.notification.create({ data: { userId: admin.id, type: "SHIFT_CHANGED", title: "x" } });
    expect(Math.abs(note.createdAt.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it("databastriggern mot framtida tid jämför mot verklig tid: pass som slutade för 1 h sedan får en registrering, ett som slutar om 1 h nekas", async () => {
    const admin = await makeAdmin(db);
    const { employee } = await makeEmployee(db, { firstName: "Erik", lastName: "Andersson" });
    const h = 3_600_000;
    const schedule = await db.schedule.create({ data: { category: "GOLFSHOP", year: 2030, month: 1 } });
    const shift = (startsAt: Date, endsAt: Date) =>
      db.shift.create({
        data: {
          scheduleId: schedule.id, category: "GOLFSHOP", assignedEmployeeId: employee.id, originalEmployeeId: employee.id,
          startsAt, endsAt, localDate: new Date("2026-01-01"), createdById: admin.id,
        },
      });
    const entry = (s: { id: string; startsAt: Date; endsAt: Date }) =>
      db.workTimeEntry.create({
        data: {
          shiftId: s.id, employeeId: employee.id, workDate: new Date("2026-01-01"), category: "GOLFSHOP", source: "SCHEDULE",
          scheduledStartsAt: s.startsAt, scheduledEndsAt: s.endsAt, scheduledMinutes: 240, registeredMinutes: 240,
        },
      });

    const ended = await shift(new Date(Date.now() - 5 * h), new Date(Date.now() - h));
    const endsSoon = await shift(new Date(Date.now() - h / 2), new Date(Date.now() + h)); // börjar efter det första slutat (inget överlapp)
    await expect(entry(ended)).resolves.toBeTruthy();
    await expect(entry(endsSoon)).rejects.toThrow(/inte avslutats/);
  });
});
