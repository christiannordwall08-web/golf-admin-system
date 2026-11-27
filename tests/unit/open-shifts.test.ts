import { describe, expect, it } from "vitest";
import { isSwapAutoApprovable, openShiftEligibility } from "@/domain/open-shifts";
import { localToInstant } from "@/domain/time";

const NOW = localToInstant("2026-12-01", "08:00");
const os = (over: Partial<Parameters<typeof openShiftEligibility>[0]["openShift"]> = {}) => ({
  category: "GOLFSHOP" as const,
  status: "OPEN" as const,
  startsAt: localToInstant("2026-12-01", "11:00"),
  endsAt: localToInstant("2026-12-01", "15:00"),
  ...over,
});
const active = { category: "GOLFSHOP" as const, status: "ACTIVE" as const };
const shift = (from: string, to: string, workStatus: "SCHEDULED" | "CANCELLED" = "SCHEDULED") => ({
  startsAt: localToInstant("2026-12-01", from),
  endsAt: localToInstant("2026-12-01", to),
  workStatus,
});

describe("openShiftEligibility", () => {
  it("en aktiv anställd i rätt grupp utan krockar får ta passet", () => {
    expect(
      openShiftEligibility({
        openShift: os(),
        employee: active,
        otherShifts: [],
        now: NOW,
      }),
    ).toEqual({ eligible: true });
  });

  it("nekar i ordning: inte ledigt, redan börjat, ingen anställning, inaktiv, fel grupp", () => {
    const reason = (input: Parameters<typeof openShiftEligibility>[0]) => {
      const r = openShiftEligibility(input);
      return r.eligible ? null : r.reason;
    };
    expect(
      reason({
        openShift: os({ status: "FILLED" }),
        employee: active,
        otherShifts: [],
        now: NOW,
      }),
    ).toBe("NOT_OPEN");
    expect(
      reason({
        openShift: os({ status: "CANCELLED" }),
        employee: active,
        otherShifts: [],
        now: NOW,
      }),
    ).toBe("NOT_OPEN");
    expect(
      reason({
        openShift: os(),
        employee: active,
        otherShifts: [],
        now: localToInstant("2026-12-01", "11:00"),
      }),
    ).toBe("ALREADY_STARTED");
    expect(reason({ openShift: os(), employee: null, otherShifts: [], now: NOW })).toBe("NO_EMPLOYMENT");
    expect(
      reason({
        openShift: os(),
        employee: { ...active, status: "INACTIVE" },
        otherShifts: [],
        now: NOW,
      }),
    ).toBe("INACTIVE");
    expect(
      reason({
        openShift: os(),
        employee: { ...active, category: "BOLLPLOCKARE" },
        otherShifts: [],
        now: NOW,
      }),
    ).toBe("CATEGORY_MISMATCH");
  });

  it("krock med eget pass nekar, men inställda pass och pass som bara möts i kanten krockar inte", () => {
    const check = (others: ReturnType<typeof shift>[]) =>
      openShiftEligibility({
        openShift: os(),
        employee: active,
        otherShifts: others,
        now: NOW,
      });
    const blocked = check([shift("14:00", "18:00")]);
    expect(blocked.eligible).toBe(false);
    if (!blocked.eligible) expect(blocked.message).toMatch(/krockar/);
    expect(check([shift("14:00", "18:00", "CANCELLED")]).eligible).toBe(true);
    expect(check([shift("07:00", "11:00"), shift("15:00", "19:00")]).eligible).toBe(true);
  });
});

describe("isSwapAutoApprovable", () => {
  it("bara när inställningen är på och bara för byten där en kollega tar ett pass", () => {
    expect(isSwapAutoApprovable("DIRECT", true)).toBe(true);
    expect(isSwapAutoApprovable("OPEN", true)).toBe(true);
    expect(isSwapAutoApprovable("EXCHANGE", true)).toBe(false);
    expect(isSwapAutoApprovable("CHANGE", true)).toBe(false);
    for (const k of ["DIRECT", "OPEN", "EXCHANGE", "CHANGE"] as const) expect(isSwapAutoApprovable(k, false)).toBe(false);
  });
});
