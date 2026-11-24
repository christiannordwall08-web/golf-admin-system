import { describe, expect, it } from "vitest";
import {
  InvalidLocalTimeError,
  dateStringToDbDate,
  dbDateToString,
  formatDateLong,
  formatDateShort,
  formatMonthYear,
  formatTimeRange,
  isWholeMinute,
  localToInstant,
  minutesBetween,
  monthBounds,
  stockholmDateOf,
  stockholmYearMonth,
} from "@/domain/time";

describe("Stockholm-datum och klockslag", () => {
  it("vintertid (UTC+1): 28 nov 11.00 = 10:00Z", () => {
    expect(localToInstant("2026-11-28", "11:00").toISOString()).toBe("2026-11-28T10:00:00.000Z");
  });

  it("sommartid (UTC+2): 1 juli 11.00 = 09:00Z", () => {
    expect(localToInstant("2026-07-01", "11:00").toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });

  it("datum bestäms av Stockholm, inte UTC: 23:30Z den 27:e är redan den 28:e", () => {
    expect(stockholmDateOf(new Date("2026-11-27T23:30:00Z"))).toBe("2026-11-28");
    expect(stockholmDateOf(new Date("2026-11-28T22:59:00Z"))).toBe("2026-11-28");
    expect(stockholmDateOf(new Date("2026-11-28T23:00:00Z"))).toBe("2026-11-29");
  });

  it("avvisar klockslag som inte finns (hoppet 29 mars 2026, 02:00 -> 03:00)", () => {
    expect(() => localToInstant("2026-03-29", "02:30")).toThrow(InvalidLocalTimeError);
    expect(localToInstant("2026-03-29", "03:00").toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("tolkar dubbeltydigt klockslag som första förekomsten (25 okt 2026, 02:30)", () => {
    expect(localToInstant("2026-10-25", "02:30").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("avvisar felaktiga indata", () => {
    expect(() => localToInstant("2026-13-01", "10:00")).toThrow();
    expect(() => localToInstant("2026-11-28", "24:00")).toThrow(RangeError);
    expect(() => localToInstant("28/11/2026", "10:00")).toThrow(RangeError);
  });
});

describe("varaktighet över sommar-/vintertidsbyte räknas på verklig tid", () => {
  it("vanligt pass 11–15 = 240 min", () => {
    const s = localToInstant("2026-11-28", "11:00");
    const e = localToInstant("2026-11-28", "15:00");
    expect(minutesBetween(s, e)).toBe(240);
  });

  it("nattpass 22:00–06:00 över vintertidsbytet (25-timmarsnatt) = 9 h", () => {
    const s = localToInstant("2026-10-24", "22:00");
    const e = localToInstant("2026-10-25", "06:00");
    expect(minutesBetween(s, e)).toBe(540);
  });

  it("nattpass 22:00–06:00 över sommartidsbytet (23-timmarsnatt) = 7 h", () => {
    const s = localToInstant("2026-03-28", "22:00");
    const e = localToInstant("2026-03-29", "06:00");
    expect(minutesBetween(s, e)).toBe(420);
  });

  it("isWholeMinute", () => {
    expect(isWholeMinute(new Date("2026-11-28T10:00:00.000Z"))).toBe(true);
    expect(isWholeMinute(new Date("2026-11-28T10:00:30.000Z"))).toBe(false);
    expect(isWholeMinute(new Date("2026-11-28T10:00:00.001Z"))).toBe(false);
  });
});

describe("månadsgränser i Stockholm", () => {
  it("november 2026: [31 okt 23:00Z, 30 nov 23:00Z)", () => {
    const { start, end } = monthBounds(2026, 11);
    expect(start.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });

  it("oktober 2026 är 1 timme längre (vintertidsbyte)", () => {
    const { start, end } = monthBounds(2026, 10);
    expect(start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(minutesBetween(start, end)).toBe((31 * 24 + 1) * 60);
  });

  it("ett pass som börjar 1 dec 00:30 Stockholm tillhör december, inte november", () => {
    expect(stockholmYearMonth(new Date("2026-11-30T23:30:00Z"))).toEqual({ year: 2026, month: 12 });
  });

  it("avvisar ogiltig månad", () => {
    expect(() => monthBounds(2026, 0)).toThrow(RangeError);
    expect(() => monthBounds(2026, 13)).toThrow(RangeError);
  });
});

describe("@db.Date-konvertering", () => {
  it("rundresa", () => {
    expect(dbDateToString(dateStringToDbDate("2026-11-28"))).toBe("2026-11-28");
  });
  it("avvisar omöjliga datum", () => {
    expect(() => dateStringToDbDate("2026-02-30")).toThrow(RangeError);
    expect(() => dateStringToDbDate("2026-2-3")).toThrow(RangeError);
  });
});

describe("formatering (svenska)", () => {
  const start = localToInstant("2026-11-28", "09:00");
  const end = localToInstant("2026-11-28", "13:00");

  it("tidsintervall", () => {
    expect(formatTimeRange(start, end)).toBe("09.00–13.00");
  });
  it("datum", () => {
    expect(formatDateLong(start)).toBe("lördag 28 november");
    expect(formatDateShort(start)).toBe("28 nov");
    expect(formatMonthYear(2026, 11)).toBe("november 2026");
  });
});
