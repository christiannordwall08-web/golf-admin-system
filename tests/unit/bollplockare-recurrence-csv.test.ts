import { describe, expect, it } from "vitest";
import { csvCell, hoursFromMinutes, toCsv } from "@/modules/bollplockare/domain/csv";
import { datesForWeekdays } from "@/modules/bollplockare/domain/recurrence";

describe("återkommande veckodagar", () => {
  it("november 2026: alla måndagar och torsdagar", () => {
    expect(datesForWeekdays("2026-11-01", "2026-11-30", [1, 4])).toEqual([
      "2026-11-02", "2026-11-05", "2026-11-09", "2026-11-12", "2026-11-16", "2026-11-19", "2026-11-23", "2026-11-26", "2026-11-30",
    ]);
  });
  it("hela veckan, söndag = 7, och ogiltiga veckodagar ignoreras", () => {
    expect(datesForWeekdays("2026-11-22", "2026-11-28", [1, 2, 3, 4, 5, 6, 7])).toHaveLength(7);
    expect(datesForWeekdays("2026-11-22", "2026-11-22", [7])).toEqual(["2026-11-22"]);
    expect(datesForWeekdays("2026-11-22", "2026-11-28", [0, 8, 99])).toEqual([]);
  });
  it("avvisar ogiltiga eller orimligt stora intervall", () => {
    expect(() => datesForWeekdays("2026-11-30", "2026-11-01", [1])).toThrow();
    expect(() => datesForWeekdays("2026-1-1", "2026-11-01", [1])).toThrow();
    expect(() => datesForWeekdays("2026-01-01", "2028-01-01", [1])).toThrow();
    expect(() => datesForWeekdays("2026-01-01", "2026-12-31", [1, 2, 3, 4, 5, 6, 7])).toThrow(/Högst/);
  });
});

describe("CSV för svensk Excel", () => {
  it("semikolon, decimalkomma, citattecken och radbrytningar hanteras", () => {
    expect(csvCell("Erik Andersson")).toBe("Erik Andersson");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('säger "hej"')).toBe('"säger ""hej"""');
    expect(csvCell("rad1\nrad2")).toBe('"rad1\nrad2"');
    expect(csvCell(1.5)).toBe("1,5");
    expect(csvCell(true)).toBe("Ja");
    expect(csvCell(false)).toBe("Nej");
    expect(csvCell(null)).toBe("");
  });
  it("skyddar mot formelinjektion i fri text", () => {
    for (const bad of ["=SUM(A1)", "+1", "-1+1", "@cmd", "\tx"]) expect(csvCell(bad).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell(-5)).toBe("-5"); // tal från appen prefixas inte
  });
  it("BOM, CRLF och rubrikrad", () => {
    const csv = toCsv(["Anställd", "Tid"], [["Åsa", 1.25]]);
    expect(csv.startsWith("﻿Anställd;Tid\r\n")).toBe(true);
    expect(csv).toContain("Åsa;1,25\r\n");
  });
  it("timmar med decimalkomma", () => {
    expect(hoursFromMinutes(102)).toBe("1,70");
    expect(hoursFromMinutes(0)).toBe("0,00");
    expect(hoursFromMinutes(null)).toBe("");
  });
});
