import { describe, expect, it } from "vitest";
import {
  type HourShift,
  estimateCompensation,
  nextShift,
  shiftPhase,
  summarizeShifts,
} from "@/domain/hours";
import type { RatePeriod } from "@/domain/pay-rates";
import { localToInstant, stockholmDateOf } from "@/domain/time";

const at = (d: string, t: string) => localToInstant(d, t);
function shift(id: string, date: string, from: string, to: string, workStatus: HourShift["workStatus"] = "SCHEDULED"): HourShift {
  const startsAt = at(date, from);
  return { id, startsAt, endsAt: at(date, to), localDate: stockholmDateOf(startsAt), workStatus };
}
const NOW = at("2026-11-24", "12:00");

describe("shiftPhase (Test 12: framtida pass är aldrig genomförda)", () => {
  it("klassar efter tid och status", () => {
    expect(shiftPhase(shift("a", "2026-11-20", "10:00", "14:00"), NOW)).toBe("COMPLETED");
    expect(shiftPhase(shift("b", "2026-11-24", "10:00", "14:00"), NOW)).toBe("ONGOING");
    expect(shiftPhase(shift("c", "2026-11-28", "10:00", "14:00"), NOW)).toBe("UPCOMING");
    expect(shiftPhase(shift("d", "2026-11-20", "10:00", "14:00", "CANCELLED"), NOW)).toBe("CANCELLED");
    expect(shiftPhase(shift("e", "2026-11-20", "10:00", "14:00", "ABSENT"), NOW)).toBe("ABSENT");
  });

  it("ett pass som slutar exakt nu är genomfört", () => {
    expect(shiftPhase(shift("a", "2026-11-24", "08:00", "12:00"), NOW)).toBe("COMPLETED");
  });
});

describe("summarizeShifts", () => {
  const shifts = [
    shift("1", "2026-11-03", "11:00", "15:00"), // 4 h genomfört
    shift("2", "2026-11-08", "10:00", "16:00"), // 6 h genomfört
    shift("3", "2026-11-24", "10:00", "14:00"), // 4 h pågår
    shift("4", "2026-11-28", "09:00", "13:00"), // 4 h kommande
    shift("5", "2026-11-05", "09:00", "17:00", "CANCELLED"), // räknas inte
    shift("6", "2026-11-06", "09:00", "17:00", "ABSENT"), // räknas inte
  ];

  it("skiljer genomfört från återstående och ignorerar inställda/frånvaro", () => {
    expect(summarizeShifts(shifts, NOW)).toEqual({
      completedMinutes: 600,
      remainingMinutes: 480,
      totalMinutes: 1080,
      completedCount: 2,
      remainingCount: 2,
    });
  });

  it("tom lista ger nollor", () => {
    expect(summarizeShifts([], NOW).totalMinutes).toBe(0);
  });
});

describe("estimateCompensation (Test 7, 11, 12)", () => {
  const rates: RatePeriod[] = [
    { id: "r1", hourlyRateOre: 14000, validFrom: "2026-01-01", validTo: "2026-11-15" },
    { id: "r2", hourlyRateOre: 15000, validFrom: "2026-11-15", validTo: null },
  ];

  it("räknar bara genomförda pass, med lönen som gällde arbetsdagen", () => {
    const shifts = [
      shift("1", "2026-11-03", "11:00", "15:00"), // 4 h × 140 = 560 kr
      shift("2", "2026-11-20", "10:00", "14:00"), // 4 h × 150 = 600 kr
      shift("3", "2026-11-28", "09:00", "13:00"), // framtid: 0
    ];
    expect(estimateCompensation(shifts, rates, NOW)).toEqual({ compensationOre: 116_000, shiftsMissingRate: 0 });
  });

  it("20 h × 150 kr = 3 000 kr (Test 7)", () => {
    const five = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d, i) => shift(String(i), d, "09:00", "13:00"));
    expect(estimateCompensation(five, rates, NOW).compensationOre).toBe(300_000);
  });

  it("pass utan gällande timlön ger 0 kr och räknas som saknad lön", () => {
    const early = shift("x", "2025-12-01", "10:00", "14:00");
    expect(estimateCompensation([early], rates, NOW)).toEqual({ compensationOre: 0, shiftsMissingRate: 1 });
  });

  it("inställda pass ger ingen ersättning", () => {
    const cancelled = shift("x", "2026-11-03", "10:00", "14:00", "CANCELLED");
    expect(estimateCompensation([cancelled], rates, NOW).compensationOre).toBe(0);
  });
});

describe("nextShift", () => {
  it("ger pågående eller närmast kommande, hoppar över genomförda och inställda", () => {
    const shifts = [
      shift("old", "2026-11-20", "10:00", "14:00"),
      shift("cancelled", "2026-11-25", "10:00", "14:00", "CANCELLED"),
      shift("later", "2026-11-28", "10:00", "14:00"),
      shift("soon", "2026-11-26", "10:00", "14:00"),
    ];
    expect(nextShift(shifts, NOW)?.id).toBe("soon");
    expect(nextShift([shift("now", "2026-11-24", "10:00", "14:00"), ...shifts], NOW)?.id).toBe("now");
    expect(nextShift([shifts[0]], NOW)).toBeNull();
  });
});
