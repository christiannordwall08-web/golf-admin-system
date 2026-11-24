import { describe, expect, it } from "vitest";
import { compensationOre } from "@/domain/money";
import {
  PayRateError,
  type RatePeriod,
  findOverlap,
  planRateChange,
  resolveRateForDate,
} from "@/domain/pay-rates";

const open = (id: string, from: string, ore: number): RatePeriod => ({ id, validFrom: from, validTo: null, hourlyRateOre: ore });

describe("resolveRateForDate", () => {
  const history: RatePeriod[] = [
    { id: "r1", validFrom: "2026-01-01", validTo: "2026-11-15", hourlyRateOre: 14000 },
    open("r2", "2026-11-15", 15000),
  ];

  it("använder lönen som gällde arbetsdagen", () => {
    expect(resolveRateForDate(history, "2026-01-01")?.hourlyRateOre).toBe(14000);
    expect(resolveRateForDate(history, "2026-11-14")?.hourlyRateOre).toBe(14000);
    expect(resolveRateForDate(history, "2026-11-15")?.hourlyRateOre).toBe(15000);
    expect(resolveRateForDate(history, "2027-03-01")?.hourlyRateOre).toBe(15000);
  });

  it("ger null före första lönen", () => {
    expect(resolveRateForDate(history, "2025-12-31")).toBeNull();
  });

  it("kastar om data är korrupt (flera perioder gäller)", () => {
    const broken = [open("a", "2026-01-01", 1), open("b", "2026-06-01", 2)];
    expect(() => resolveRateForDate(broken, "2026-07-01")).toThrow(PayRateError);
  });
});

describe("Test 11: historisk timlön", () => {
  it("Erik 140 kr -> 150 kr från 15 nov: pass före höjningen räknas fortfarande med 140 kr", () => {
    const before: RatePeriod[] = [open("r1", "2026-01-01", 14000)];
    const plan = planRateChange(before, { hourlyRateOre: 15000, effectiveFrom: "2026-11-15" });

    expect(plan.close).toEqual({ id: "r1", validTo: "2026-11-15" });
    expect(plan.insert).toEqual({ hourlyRateOre: 15000, validFrom: "2026-11-15", validTo: null });

    const after: RatePeriod[] = [
      { id: "r1", validFrom: "2026-01-01", validTo: plan.close!.validTo, hourlyRateOre: 14000 },
      { id: "r2", ...plan.insert },
    ];
    expect(findOverlap(after)).toBeNull();

    const earlyShift = resolveRateForDate(after, "2026-11-03")!;
    const lateShift = resolveRateForDate(after, "2026-11-20")!;
    expect(compensationOre(240, earlyShift.hourlyRateOre)).toBe(56_000); // 4 h × 140 kr
    expect(compensationOre(240, lateShift.hourlyRateOre)).toBe(60_000); // 4 h × 150 kr
  });

  it("avvisar retroaktiv ändring som skulle skriva om historiken", () => {
    const history = [open("r1", "2026-01-01", 14000)];
    expect(() => planRateChange(history, { hourlyRateOre: 15000, effectiveFrom: "2026-01-01" })).toThrow(
      expect.objectContaining({ code: "RATE_CHANGE_NOT_AFTER_CURRENT" }),
    );
    expect(() => planRateChange(history, { hourlyRateOre: 15000, effectiveFrom: "2025-06-01" })).toThrow(
      expect.objectContaining({ code: "RATE_CHANGE_NOT_AFTER_CURRENT" }),
    );
  });

  it("avvisar oförändrad lön och ogiltiga värden", () => {
    const history = [open("r1", "2026-01-01", 14000)];
    expect(() => planRateChange(history, { hourlyRateOre: 14000, effectiveFrom: "2026-06-01" })).toThrow(
      expect.objectContaining({ code: "RATE_UNCHANGED" }),
    );
    expect(() => planRateChange(history, { hourlyRateOre: -1, effectiveFrom: "2026-06-01" })).toThrow(
      expect.objectContaining({ code: "INVALID_RATE" }),
    );
    expect(() => planRateChange(history, { hourlyRateOre: 140.5, effectiveFrom: "2026-06-01" })).toThrow(
      expect.objectContaining({ code: "INVALID_RATE" }),
    );
    expect(() => planRateChange(history, { hourlyRateOre: 15000, effectiveFrom: "2026-02-30" })).toThrow(
      expect.objectContaining({ code: "INVALID_DATE" }),
    );
  });

  it("första lönen för en ny anställd skapar bara en ny period", () => {
    const plan = planRateChange([], { hourlyRateOre: 14000, effectiveFrom: "2026-11-01" });
    expect(plan.close).toBeNull();
    expect(plan.insert.validFrom).toBe("2026-11-01");
  });

  it("ny lön efter en avslutad period får inte börja före periodens slut", () => {
    const closed: RatePeriod[] = [{ id: "r1", validFrom: "2026-01-01", validTo: "2026-06-01", hourlyRateOre: 14000 }];
    expect(() => planRateChange(closed, { hourlyRateOre: 15000, effectiveFrom: "2026-05-01" })).toThrow(
      expect.objectContaining({ code: "RATE_CHANGE_BEFORE_LAST_PERIOD" }),
    );
    expect(planRateChange(closed, { hourlyRateOre: 15000, effectiveFrom: "2026-06-01" }).close).toBeNull();
  });
});

describe("findOverlap", () => {
  it("hittar överlappande perioder men inte angränsande", () => {
    const adjacent: RatePeriod[] = [
      { id: "a", validFrom: "2026-01-01", validTo: "2026-06-01", hourlyRateOre: 1 },
      { id: "b", validFrom: "2026-06-01", validTo: null, hourlyRateOre: 2 },
    ];
    expect(findOverlap(adjacent)).toBeNull();
    const overlapping: RatePeriod[] = [
      { id: "a", validFrom: "2026-01-01", validTo: "2026-07-01", hourlyRateOre: 1 },
      { id: "b", validFrom: "2026-06-01", validTo: null, hourlyRateOre: 2 },
    ];
    expect(findOverlap(overlapping)).not.toBeNull();
  });
});
