import { describe, expect, it } from "vitest";
import { compensationOre, formatDuration, formatSek, kronorToOre, sumOre } from "@/domain/money";

describe("kronorToOre", () => {
  it.each([
    ["140", 14000],
    ["140,5", 14050],
    ["140.50", 14050],
    [" 1 250 ", 125000],
    ["0,05", 5],
  ])("tolkar %s som %i öre", (input, expected) => {
    expect(kronorToOre(input)).toBe(expected);
  });

  it.each(["", "-1", "1,234", "abc", "1e3", "12,3,4", "1.000.000.000"])("avvisar %s", (input) => {
    expect(() => kronorToOre(input)).toThrow(RangeError);
  });
});

describe("compensationOre (Test 7 + exempel ur specen)", () => {
  it("Lisa: 20 godkända timmar × 150 kr = 3 000 kr", () => {
    expect(compensationOre(20 * 60, kronorToOre("150"))).toBe(300_000);
    expect(formatSek(compensationOre(20 * 60, kronorToOre("150")))).toBe("3 000 kr");
  });

  it("Erik: 65 h × 140 kr = 9 100 kr", () => {
    expect(compensationOre(65 * 60, 14000)).toBe(910_000);
  });

  it("pass i rapporten: 4 h × 140 = 560 kr, 6 h × 140 = 840 kr", () => {
    expect(compensationOre(240, 14000)).toBe(56_000);
    expect(compensationOre(360, 14000)).toBe(84_000);
  });

  it("avrundar halv öre uppåt, en gång per rad", () => {
    expect(compensationOre(3, 50)).toBe(3); // 2,5 öre -> 3
    expect(compensationOre(1, 14000)).toBe(233); // 233,33 -> 233
    expect(compensationOre(1, 15000)).toBe(250);
    expect(compensationOre(7, 14050)).toBe(1639); // 1639,17 -> 1639
  });

  it("ger 0 för 0 minuter eller 0 i timlön", () => {
    expect(compensationOre(0, 14000)).toBe(0);
    expect(compensationOre(240, 0)).toBe(0);
  });

  it("avvisar negativa och icke-heltal", () => {
    expect(() => compensationOre(-1, 14000)).toThrow(RangeError);
    expect(() => compensationOre(60, -1)).toThrow(RangeError);
    expect(() => compensationOre(1.5, 14000)).toThrow(RangeError);
    expect(() => compensationOre(60, 140.5)).toThrow(RangeError);
  });

  it("använder ingen flyttalsaritmetik (0,1 + 0,2-problemet finns inte)", () => {
    // 1/3 timme × 90 kr: ett flyttalsfel skulle kunna ge 2999 eller 3001
    expect(compensationOre(20, 9000)).toBe(3000);
  });
});

describe("sumOre", () => {
  it("summerar exakt som BigInt", () => {
    expect(sumOre([56_000, 84_000, 56_000])).toBe(196_000n);
    expect(sumOre([])).toBe(0n);
  });
});

describe("formatSek / formatDuration", () => {
  it("formaterar kronor med hårda mellanslag och bara decimaler när de behövs", () => {
    expect(formatSek(910_000)).toBe("9 100 kr");
    expect(formatSek(14_050)).toBe("140,50 kr");
    expect(formatSek(0)).toBe("0 kr");
    expect(formatSek(123_456_789n)).toBe("1 234 567,89 kr");
    expect(formatSek(-5000)).toBe("−50 kr");
  });

  it("formaterar varaktighet", () => {
    expect(formatDuration(240)).toBe("4 h");
    expect(formatDuration(270)).toBe("4 h 30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(0)).toBe("0 min");
  });
});
