import { describe, expect, it } from "vitest";
import { planDemoShifts } from "@/server/demo-data";
import { localToInstant } from "@/domain/time";

const NOW = localToInstant("2026-11-24", "12:00");
const MONTHS = [{ year: 2026, month: 11 }, { year: 2026, month: 12 }];

describe("planDemoShifts (testschema)", () => {
  it("ger pass för båda grupperna, högst ett per dag och bara i angivna månader", () => {
    for (const category of ["GOLFSHOP", "BOLLPLOCKARE"] as const) {
      for (let index = 0; index < 4; index++) {
        const plan = planDemoShifts(category, index, MONTHS, NOW);
        expect(plan.length).toBeGreaterThan(5);
        const dates = plan.map((p) => p.date);
        expect(new Set(dates).size).toBe(dates.length);
        expect(dates.every((d) => d.startsWith("2026-11") || d.startsWith("2026-12"))).toBe(true);
      }
    }
  });

  it("är deterministisk och sprider personerna över olika dagar", () => {
    const a = planDemoShifts("GOLFSHOP", 0, MONTHS, NOW);
    expect(planDemoShifts("GOLFSHOP", 0, MONTHS, NOW)).toEqual(a);
    expect(planDemoShifts("GOLFSHOP", 1, MONTHS, NOW).map((p) => p.date)).not.toEqual(a.map((p) => p.date));
  });

  it("passen börjar och slutar samma dag och slutar efter start", () => {
    for (const p of planDemoShifts("BOLLPLOCKARE", 2, MONTHS, NOW)) {
      expect(p.to > p.from).toBe(true);
    }
  });

  it("passerade dagar är alltid godkända, framtida varierar", () => {
    const plan = planDemoShifts("GOLFSHOP", 0, MONTHS, NOW);
    expect(plan.filter((p) => p.date < "2026-11-24").every((p) => p.approval === "APPROVED")).toBe(true);
    expect(plan.some((p) => p.date > "2026-11-24" && p.approval === "PENDING")).toBe(true);
  });
});
