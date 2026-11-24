import { describe, expect, it } from "vitest";
import {
  type ExistingShift,
  analyzeShift,
  hasBlockingIssues,
  hasShiftEnded,
  intervalsOverlap,
  isMaterialShiftChange,
  validateShiftTimes,
} from "@/domain/shifts";
import { localToInstant } from "@/domain/time";

const at = (date: string, time: string) => localToInstant(date, time);
const erik = { id: "erik", category: "GOLFSHOP" as const, status: "ACTIVE" as const };

function existing(id: string, from: string, to: string, extra: Partial<ExistingShift> = {}): ExistingShift {
  return {
    id,
    startsAt: at("2026-11-28", from),
    endsAt: at("2026-11-28", to),
    workStatus: "SCHEDULED",
    ...extra,
  };
}

describe("intervalsOverlap (halvöppna intervall)", () => {
  const a = { startsAt: at("2026-11-28", "11:00"), endsAt: at("2026-11-28", "15:00") };
  it("detekterar överlapp", () => {
    expect(intervalsOverlap(a, { startsAt: at("2026-11-28", "14:00"), endsAt: at("2026-11-28", "18:00") })).toBe(true);
    expect(intervalsOverlap(a, { startsAt: at("2026-11-28", "12:00"), endsAt: at("2026-11-28", "13:00") })).toBe(true);
  });
  it("pass som slutar när nästa börjar krockar inte", () => {
    expect(intervalsOverlap(a, { startsAt: at("2026-11-28", "15:00"), endsAt: at("2026-11-28", "19:00") })).toBe(false);
    expect(intervalsOverlap(a, { startsAt: at("2026-11-28", "07:00"), endsAt: at("2026-11-28", "11:00") })).toBe(false);
  });
});

describe("analyzeShift – automatiska kontroller (spec 6.3)", () => {
  const candidate = {
    category: "GOLFSHOP" as const,
    assignedEmployeeId: "erik",
    startsAt: at("2026-11-28", "11:00"),
    endsAt: at("2026-11-28", "15:00"),
  };

  it("Test 1: ett giltigt pass för Erik 28 nov 11–15 ger inga anmärkningar", () => {
    expect(analyzeShift({ candidate, employee: erik, otherShiftsOfEmployee: [] })).toEqual([]);
  });

  it("Test 2: två anställda samma dag påverkar inte varandra (filtreras per anställd)", () => {
    // Lisas pass ingår inte i Eriks lista – krock bedöms bara mot samma persons pass.
    const issues = analyzeShift({ candidate, employee: erik, otherShiftsOfEmployee: [] });
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("varnar vid överlappande pass för samma person", () => {
    const issues = analyzeShift({
      candidate,
      employee: erik,
      otherShiftsOfEmployee: [existing("s1", "13:00", "17:00")],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "OVERLAP", severity: "error", relatedShiftIds: ["s1"] });
  });

  it("ignorerar inställda pass och passet självt vid redigering", () => {
    const issues = analyzeShift({
      candidate: { ...candidate, id: "self" },
      employee: erik,
      otherShiftsOfEmployee: [
        existing("self", "11:00", "15:00"),
        existing("cancelled", "12:00", "14:00", { workStatus: "CANCELLED" }),
      ],
    });
    expect(issues).toEqual([]);
  });

  it("felaktiga tider: slut före start, sekunder, för långt pass", () => {
    const inverted = analyzeShift({
      candidate: { ...candidate, startsAt: at("2026-11-28", "15:00"), endsAt: at("2026-11-28", "11:00") },
      employee: erik,
      otherShiftsOfEmployee: [],
    });
    expect(inverted.map((i) => i.code)).toEqual(["INVALID_TIMES"]);

    expect(
      validateShiftTimes({ startsAt: at("2026-11-28", "11:00"), endsAt: new Date(at("2026-11-28", "15:00").getTime() + 5000) })?.code,
    ).toBe("INVALID_TIMES");

    expect(
      validateShiftTimes({ startsAt: at("2026-11-28", "05:00"), endsAt: at("2026-11-28", "22:00") })?.code,
    ).toBe("INVALID_TIMES");
  });

  it("pass utan anställd är ett fel", () => {
    const issues = analyzeShift({
      candidate: { ...candidate, assignedEmployeeId: null },
      employee: null,
      otherShiftsOfEmployee: [],
    });
    expect(issues.map((i) => i.code)).toEqual(["MISSING_EMPLOYEE"]);
  });

  it("fel arbetskategori och inaktiverad anställd är fel", () => {
    const issues = analyzeShift({
      candidate,
      employee: { id: "oscar", category: "BOLLPLOCKARE", status: "INACTIVE" },
      otherShiftsOfEmployee: [],
    });
    expect(issues.map((i) => i.code).sort()).toEqual(["CATEGORY_MISMATCH", "EMPLOYEE_INACTIVE"]);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("ändring av redan godkänt pass ger varning (kräver nytt godkännande)", () => {
    const previous = {
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      category: candidate.category,
      assignedEmployeeId: "erik",
      approvalStatus: "APPROVED" as const,
    };
    const moved = { ...candidate, id: "s", endsAt: at("2026-11-28", "16:00") };
    const issues = analyzeShift({ candidate: moved, employee: erik, otherShiftsOfEmployee: [], previous });
    expect(issues).toEqual([expect.objectContaining({ code: "APPROVED_SHIFT_CHANGED", severity: "warning" })]);
    expect(hasBlockingIssues(issues)).toBe(false);

    // Bara anteckning ändrad (samma tider/person) => ingen varning
    const same = analyzeShift({ candidate: { ...candidate, id: "s" }, employee: erik, otherShiftsOfEmployee: [], previous });
    expect(same).toEqual([]);
  });
});

describe("isMaterialShiftChange", () => {
  const base = {
    startsAt: at("2026-11-28", "11:00"),
    endsAt: at("2026-11-28", "15:00"),
    category: "GOLFSHOP" as const,
    assignedEmployeeId: "erik",
  };
  it("person, tid eller kategori = väsentligt", () => {
    expect(isMaterialShiftChange(base, { ...base, assignedEmployeeId: "lisa" })).toBe(true);
    expect(isMaterialShiftChange(base, { ...base, endsAt: at("2026-11-28", "16:00") })).toBe(true);
    expect(isMaterialShiftChange(base, { ...base, category: "BOLLPLOCKARE" })).toBe(true);
    expect(isMaterialShiftChange(base, { ...base })).toBe(false);
  });
});

describe("Test 12: framtida pass är aldrig genomförda", () => {
  const shift = { endsAt: at("2026-11-28", "15:00") };
  it("före sluttid = ej genomfört, från sluttid = genomfört", () => {
    expect(hasShiftEnded(shift, at("2026-11-24", "12:00"))).toBe(false);
    expect(hasShiftEnded(shift, at("2026-11-28", "14:59"))).toBe(false);
    expect(hasShiftEnded(shift, at("2026-11-28", "15:00"))).toBe(true);
    expect(hasShiftEnded(shift, at("2026-11-29", "09:00"))).toBe(true);
  });
});
