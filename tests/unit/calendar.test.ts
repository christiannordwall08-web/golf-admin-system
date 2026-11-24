import { describe, expect, it } from "vitest";
import { buildMonthGrid, monthParam, parseMonthParam, shiftMonth } from "@/domain/calendar";
import { dayBounds, localToInstant, minutesBetween } from "@/domain/time";

const NOW = localToInstant("2026-11-24", "12:00");

describe("månadsparametern", () => {
  it("tolkar giltiga värden och faller tillbaka på innevarande månad", () => {
    expect(parseMonthParam("2026-12", NOW)).toEqual({ year: 2026, month: 12 });
    for (const bad of [undefined, null, "", "2026-13", "2026-00", "26-11", "abc", "1999-05", "2101-01"]) {
      expect(parseMonthParam(bad, NOW)).toEqual({ year: 2026, month: 11 });
    }
  });

  it("monthParam och shiftMonth går över årsskiften", () => {
    expect(monthParam({ year: 2026, month: 3 })).toBe("2026-03");
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("buildMonthGrid", () => {
  it("november 2026 (börjar på en söndag, slutar på en måndag): 6 hela veckor, 26 okt – 6 dec", () => {
    const weeks = buildMonthGrid({ year: 2026, month: 11 }, NOW);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toMatchObject({ date: "2026-10-26", inMonth: false });
    expect(weeks[0][6]).toMatchObject({ date: "2026-11-01", inMonth: true });
    expect(weeks[5][0]).toMatchObject({ date: "2026-11-30", inMonth: true });
    expect(weeks[5][6]).toMatchObject({ date: "2026-12-06", inMonth: false });
  });

  it("markerar idag (Stockholm) och helger", () => {
    const flat = buildMonthGrid({ year: 2026, month: 11 }, NOW).flat();
    expect(flat.filter((d) => d.isToday).map((d) => d.date)).toEqual(["2026-11-24"]);
    expect(flat.find((d) => d.date === "2026-11-28")?.isWeekend).toBe(true); // lördag
    expect(flat.find((d) => d.date === "2026-11-30")?.isWeekend).toBe(false); // måndag
  });

  it("månad som börjar på en måndag och slutar på en söndag ger exakt 4 veckor (feb 2027)", () => {
    const weeks = buildMonthGrid({ year: 2027, month: 2 }, NOW);
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0].date).toBe("2027-02-01");
    expect(weeks[3][6].date).toBe("2027-02-28");
  });
});

describe("dayBounds", () => {
  it("vanligt dygn är 24 h, tidsbytesdygn 25 h / 23 h", () => {
    const d = dayBounds("2026-11-24");
    expect(minutesBetween(d.start, d.end)).toBe(24 * 60);
    expect(minutesBetween(dayBounds("2026-10-25").start, dayBounds("2026-10-25").end)).toBe(25 * 60);
    expect(minutesBetween(dayBounds("2026-03-29").start, dayBounds("2026-03-29").end)).toBe(23 * 60);
  });
});
