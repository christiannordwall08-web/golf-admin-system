import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { listMyNotifications } from "@/server/services/notifications";
import {
  assignOpenShift,
  cancelOpenShift,
  claimOpenShift,
  createOpenShift,
  getOpenShiftForAdmin,
  getSchedulingSettings,
  listOpenShiftsForEmployee,
  updateSchedulingSettings,
  withdrawClaim,
} from "@/server/services/open-shifts";
import { createShift } from "@/server/services/shifts";
import { createSwapRequest, respondToSwap } from "@/server/services/swaps";
import { makeAdmin, makeEmployee, resetDb, testDb } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");
const A = "2026-11-25";

beforeEach(async () => {
  await resetDb(db);
});

async function world() {
  const adminUser = await makeAdmin(db, "Adam");
  const admin = { id: adminUser.id, role: "ADMIN" as const };
  const mk = (n: string) => makeEmployee(db, { firstName: n, lastName: "X", category: "GOLFSHOP" });
  const [erik, olle, pia] = [await mk("Erik"), await mk("Olle"), await mk("Pia")];
  const other = await makeEmployee(db, {
    firstName: "Gun",
    lastName: "Z",
    category: "BOLLPLOCKARE",
  });
  const act = (u: { id: string }) => ({ id: u.id, role: "GOLFSHOP" }) as const;
  const post = async (opts: { autoAssign: boolean; from?: string; to?: string; date?: string }) => {
    const r = await createOpenShift(db, admin, {
      category: "GOLFSHOP",
      date: opts.date ?? A,
      from: opts.from ?? "11:00",
      to: opts.to ?? "15:00",
      autoAssign: opts.autoAssign,
      now: NOW,
    });
    if (!r.ok) throw new Error(r.issues.map((i) => i.message).join());
    return r;
  };
  return {
    admin,
    adminUser,
    erik,
    olle,
    pia,
    other,
    eAct: act(erik.user!),
    oAct: act(olle.user!),
    pAct: act(pia.user!),
    post,
  };
}

describe("lediga pass: först till kvarn", () => {
  it("Admin lägger ut → bara behöriga får notis → första som tar passet får en vanlig, godkänd Shift", async () => {
    const w = await world();
    // Pia jobbar redan då: hon ska inte få någon notis
    const busy = await createShift(db, w.admin, {
      employeeId: w.pia.employee.id,
      date: A,
      from: "13:00",
      to: "17:00",
      publish: true,
      now: NOW,
    });
    expect(busy.ok).toBe(true);

    const { id, notified } = await w.post({ autoAssign: true });
    expect(notified).toBe(2);
    expect((await listMyNotifications(db, w.erik.user!.id)).some((n) => n.type === "OPEN_SHIFT_POSTED" && n.linkPath === "/golfshop/lediga-pass")).toBe(true);
    expect((await listMyNotifications(db, w.pia.user!.id)).some((n) => n.type === "OPEN_SHIFT_POSTED")).toBe(false);
    expect((await listMyNotifications(db, w.other.user!.id)).some((n) => n.type === "OPEN_SHIFT_POSTED")).toBe(false);

    // Pia ser passet men kan inte ta det
    const piaView = await listOpenShiftsForEmployee(db, w.pAct, "GOLFSHOP", NOW);
    expect(piaView[0]?.blockedBy).toMatch(/krockar/);
    await expect(claimOpenShift(db, w.pAct, id, NOW)).rejects.toThrow(ValidationError);

    const r = await claimOpenShift(db, w.eAct, id, NOW);
    expect(r.assigned).toBe(true);
    const shift = await db.shift.findUniqueOrThrow({
      where: { id: r.assigned ? r.shiftId : "" },
      include: { assignmentHistory: true, approvals: true },
    });
    expect(shift.assignedEmployeeId).toBe(w.erik.employee.id);
    expect(shift.originalEmployeeId).toBe(w.erik.employee.id);
    expect(shift.publicationStatus).toBe("PUBLISHED");
    expect(shift.approvalStatus).toBe("APPROVED");
    expect(shift.assignmentHistory[0]?.reason).toBe("OPEN_SHIFT");
    expect(shift.approvals).toHaveLength(1);

    const os = await db.openShift.findUniqueOrThrow({ where: { id } });
    expect(os.status).toBe("FILLED");
    expect(os.filledShiftId).toBe(shift.id);
    expect((await listMyNotifications(db, w.erik.user!.id)).some((n) => n.type === "OPEN_SHIFT_ASSIGNED")).toBe(true);
    expect((await listMyNotifications(db, w.adminUser.id)).some((n) => n.type === "OPEN_SHIFT_CLAIMED")).toBe(true);
    expect(
      await db.auditLog.count({
        where: { action: "OPEN_SHIFT_FILLED", entityId: id },
      }),
    ).toBe(1);

    // Nästa person kommer för sent
    await expect(claimOpenShift(db, w.oAct, id, NOW)).rejects.toThrow(ConflictError);
    expect(await listOpenShiftsForEmployee(db, w.oAct, "GOLFSHOP", NOW)).toHaveLength(0);
  });

  it("två som tar samma pass samtidigt: exakt en får det", async () => {
    const w = await world();
    const { id } = await w.post({ autoAssign: true });
    const results = await Promise.allSettled([claimOpenShift(db, w.eAct, id, NOW), claimOpenShift(db, w.oAct, id, NOW), claimOpenShift(db, w.pAct, id, NOW)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.shift.count({
        where: { localDate: new Date(`${A}T00:00:00Z`) },
      }),
    ).toBe(1);
    expect(
      await db.openShiftClaim.count({
        where: { openShiftId: id, status: "ACCEPTED" },
      }),
    ).toBe(1);
  });
});

describe("lediga pass: Admin väljer", () => {
  it("intresseanmälan → Admin ger passet till en → de andra får nej och notis", async () => {
    const w = await world();
    const { id } = await w.post({ autoAssign: false });
    expect(await claimOpenShift(db, w.eAct, id, NOW)).toEqual({
      assigned: false,
    });
    expect(await claimOpenShift(db, w.oAct, id, NOW)).toEqual({
      assigned: false,
    });
    expect(await claimOpenShift(db, w.oAct, id, NOW)).toEqual({
      assigned: false,
    }); // idempotent
    expect(await db.shift.count()).toBe(0);
    expect((await listMyNotifications(db, w.adminUser.id)).filter((n) => n.type === "OPEN_SHIFT_CLAIMED")).toHaveLength(2);

    const detail = await getOpenShiftForAdmin(db, w.admin, id, NOW);
    const olleClaim = detail.claims.find((c) => c.name.startsWith("Olle"))!;
    await assignOpenShift(db, w.admin, id, olleClaim.id, NOW);

    const os = await db.openShift.findUniqueOrThrow({
      where: { id },
      include: { filledShift: true, claims: true },
    });
    expect(os.status).toBe("FILLED");
    expect(os.filledShift?.assignedEmployeeId).toBe(w.olle.employee.id);
    expect(os.claims.find((c) => c.employeeId === w.erik.employee.id)?.status).toBe("REJECTED");
    expect((await listMyNotifications(db, w.erik.user!.id)).some((n) => n.type === "OPEN_SHIFT_NOT_ASSIGNED")).toBe(true);
    expect((await listMyNotifications(db, w.olle.user!.id)).some((n) => n.type === "OPEN_SHIFT_ASSIGNED")).toBe(true);
  });

  it("återkalla och anmäla igen; Admin kan inte ge passet till någon som fått en krock", async () => {
    const w = await world();
    const { id } = await w.post({ autoAssign: false });
    await claimOpenShift(db, w.eAct, id, NOW);
    await withdrawClaim(db, w.eAct, id);
    await expect(withdrawClaim(db, w.eAct, id)).rejects.toThrow(ConflictError);
    await claimOpenShift(db, w.eAct, id, NOW);
    const claim = await db.openShiftClaim.findFirstOrThrow({
      where: { openShiftId: id, employeeId: w.erik.employee.id },
    });
    expect(claim.status).toBe("PENDING");

    await createShift(db, w.admin, {
      employeeId: w.erik.employee.id,
      date: A,
      from: "14:00",
      to: "18:00",
      publish: true,
      now: NOW,
    });
    await expect(assignOpenShift(db, w.admin, id, claim.id, NOW)).rejects.toThrow(/krock/);
    expect((await db.openShift.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
  });

  it("indragning: intresseanmälda får nej och notis, passet kan inte tas efteråt", async () => {
    const w = await world();
    const { id } = await w.post({ autoAssign: false });
    await claimOpenShift(db, w.eAct, id, NOW);
    await expect(cancelOpenShift(db, w.admin, id, "x", NOW)).rejects.toThrow(ValidationError);
    await cancelOpenShift(db, w.admin, id, "Regn, shoppen stänger", NOW);
    expect((await db.openShift.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    expect((await db.openShiftClaim.findFirstOrThrow({ where: { openShiftId: id } })).status).toBe("REJECTED");
    expect((await listMyNotifications(db, w.erik.user!.id)).some((n) => n.type === "OPEN_SHIFT_CANCELLED")).toBe(true);
    await expect(claimOpenShift(db, w.oAct, id, NOW)).rejects.toThrow(ConflictError);
  });
});

describe("lediga pass: behörighet och validering", () => {
  it("personal kan inte lägga ut, tillsätta eller dra in; fel grupp kan inte ta passet", async () => {
    const w = await world();
    await expect(
      createOpenShift(db, w.eAct, {
        category: "GOLFSHOP",
        date: A,
        from: "11:00",
        to: "15:00",
        now: NOW,
      }),
    ).rejects.toThrow(ForbiddenError);
    const { id } = await w.post({ autoAssign: false });
    await expect(cancelOpenShift(db, w.eAct, id, "Vill inte", NOW)).rejects.toThrow(ForbiddenError);
    await expect(getOpenShiftForAdmin(db, w.eAct, id, NOW)).rejects.toThrow(ForbiddenError);
    await expect(claimOpenShift(db, { id: w.other.user!.id, role: "BOLLPLOCKARE" }, id, NOW)).rejects.toThrow(ForbiddenError);
  });

  it("pass i det förflutna och omvända tider nekas", async () => {
    const w = await world();
    const past = await createOpenShift(db, w.admin, {
      category: "GOLFSHOP",
      date: "2026-11-19",
      from: "11:00",
      to: "15:00",
      now: NOW,
    });
    expect(past.ok).toBe(false);
    const bad = await createOpenShift(db, w.admin, {
      category: "GOLFSHOP",
      date: A,
      from: "15:00",
      to: "11:00",
      now: NOW,
    });
    expect(bad.ok).toBe(false);
  });

  it("utelämnat tillsättningssätt följer Admins förval", async () => {
    const w = await world();
    expect(await getSchedulingSettings(db)).toEqual({
      autoApproveSwaps: false,
      openShiftAutoAssignDefault: true,
    });
    await updateSchedulingSettings(db, w.admin, {
      autoApproveSwaps: false,
      openShiftAutoAssignDefault: false,
    });
    const r = await createOpenShift(db, w.admin, {
      category: "GOLFSHOP",
      date: A,
      from: "11:00",
      to: "15:00",
      now: NOW,
    });
    expect(r.ok && (await db.openShift.findUniqueOrThrow({ where: { id: r.id } })).autoAssign).toBe(false);
    await expect(
      updateSchedulingSettings(db, w.eAct, {
        autoApproveSwaps: true,
        openShiftAutoAssignDefault: true,
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("passbyten: notiser och automatiskt godkännande", () => {
  it("öppen förfrågan går bara till kollegor som kan ta passet", async () => {
    const w = await world();
    const s = await createShift(db, w.admin, {
      employeeId: w.erik.employee.id,
      date: A,
      from: "11:00",
      to: "15:00",
      publish: true,
      now: NOW,
    });
    await createShift(db, w.admin, {
      employeeId: w.pia.employee.id,
      date: A,
      from: "12:00",
      to: "16:00",
      publish: true,
      now: NOW,
    });
    if (!s.ok) throw new Error("shift");
    await createSwapRequest(db, w.eAct, {
      shiftId: s.shiftId,
      kind: "OPEN",
      reason: "Tandläkare",
      now: NOW,
    });
    expect((await listMyNotifications(db, w.olle.user!.id)).some((n) => n.type === "SWAP_REQUESTED")).toBe(true);
    expect((await listMyNotifications(db, w.pia.user!.id)).some((n) => n.type === "SWAP_REQUESTED")).toBe(false);
  });

  it("med inställningen på godkänns ett direktbyte när kollegan tackar ja; av = Admin beslutar som förut", async () => {
    const w = await world();
    const mkSwap = async (date: string) => {
      const s = await createShift(db, w.admin, {
        employeeId: w.erik.employee.id,
        date,
        from: "11:00",
        to: "15:00",
        publish: true,
        now: NOW,
      });
      if (!s.ok) throw new Error("shift");
      const { id } = await createSwapRequest(db, w.eAct, {
        shiftId: s.shiftId,
        kind: "DIRECT",
        proposedEmployeeId: w.olle.employee.id,
        reason: "Läkartid",
        now: NOW,
      });
      return { shiftId: s.shiftId, id };
    };

    const off = await mkSwap(A);
    await respondToSwap(db, w.oAct, off.id, { accept: true, now: NOW });
    expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id: off.id } })).status).toBe("AWAITING_ADMIN");

    await updateSchedulingSettings(db, w.admin, {
      autoApproveSwaps: true,
      openShiftAutoAssignDefault: true,
    });
    const on = await mkSwap("2026-11-26");
    await respondToSwap(db, w.oAct, on.id, { accept: true, now: NOW });
    const req = await db.shiftSwapRequest.findUniqueOrThrow({
      where: { id: on.id },
    });
    expect(req.status).toBe("APPROVED");
    expect(req.decidedById).toBeNull();
    expect((await db.shift.findUniqueOrThrow({ where: { id: on.shiftId } })).assignedEmployeeId).toBe(w.olle.employee.id);
    expect((await listMyNotifications(db, w.adminUser.id)).some((n) => n.type === "SWAP_APPROVED" && n.title.includes("automatiskt"))).toBe(true);
  });

  it("automatiskt godkännande som bryter en regel går till Admin i stället", async () => {
    const w = await world();
    await updateSchedulingSettings(db, w.admin, {
      autoApproveSwaps: true,
      openShiftAutoAssignDefault: true,
    });
    const s = await createShift(db, w.admin, {
      employeeId: w.erik.employee.id,
      date: A,
      from: "11:00",
      to: "15:00",
      publish: true,
      now: NOW,
    });
    if (!s.ok) throw new Error("shift");
    const { id } = await createSwapRequest(db, w.eAct, {
      shiftId: s.shiftId,
      kind: "DIRECT",
      proposedEmployeeId: w.olle.employee.id,
      reason: "Läkartid",
      now: NOW,
    });
    // Olle får ett krockande pass efter förfrågan men innan han svarar
    await createShift(db, w.admin, {
      employeeId: w.olle.employee.id,
      date: A,
      from: "14:00",
      to: "18:00",
      publish: true,
      now: NOW,
    });
    await respondToSwap(db, w.oAct, id, { accept: true, now: NOW }).catch(() => undefined);
    const req = await db.shiftSwapRequest.findUniqueOrThrow({ where: { id } });
    expect(req.status).not.toBe("APPROVED");
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.shiftId } })).assignedEmployeeId).toBe(w.erik.employee.id);
  });
});

describe("lediga pass: databasregler", () => {
  it("ett tillsatt pass måste peka på en Shift, och högst en anmälan kan vara antagen", async () => {
    const w = await world();
    const { id } = await w.post({ autoAssign: false });
    await expect(db.openShift.update({ where: { id }, data: { status: "FILLED" } })).rejects.toThrow();
    const c1 = await db.openShiftClaim.create({
      data: { openShiftId: id, employeeId: w.erik.employee.id },
    });
    const c2 = await db.openShiftClaim.create({
      data: { openShiftId: id, employeeId: w.olle.employee.id },
    });
    await db.openShiftClaim.update({
      where: { id: c1.id },
      data: { status: "ACCEPTED", decidedAt: NOW },
    });
    await expect(
      db.openShiftClaim.update({
        where: { id: c2.id },
        data: { status: "ACCEPTED", decidedAt: NOW },
      }),
    ).rejects.toThrow();
  });
});
