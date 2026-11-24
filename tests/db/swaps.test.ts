import { beforeEach, describe, expect, it } from "vitest";
import { clockIn } from "@/modules/bollplockare/server/clock";
import { saveWorkArea } from "@/modules/bollplockare/server/settings";
import { interiorPoint, offsetPoint, type Pt } from "@/modules/bollplockare/domain/geo";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { listMyNotifications } from "@/server/services/notifications";
import { createShift, updateShift } from "@/server/services/shifts";
import {
  cancelSwapRequest,
  createSwapRequest,
  decideSwap,
  getSwapDetail,
  listColleagueShifts,
  listColleagues,
  listMySwaps,
  listSwapsForAdmin,
  postSwapMessage,
  respondToSwap,
} from "@/server/services/swaps";
import { localToInstant } from "@/domain/time";
import { makeAdmin, makeEmployee, resetDb, testDb } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");
const A = "2026-11-25";
const B = "2026-11-26";

beforeEach(async () => {
  await resetDb(db);
});

async function world(category: "BOLLPLOCKARE" | "GOLFSHOP" = "BOLLPLOCKARE") {
  const adminUser = await makeAdmin(db, "Adam");
  const admin = { id: adminUser.id, role: "ADMIN" as const };
  const mk = (n: string) => makeEmployee(db, { firstName: n, lastName: "X", category });
  const [erik, olle, pia] = [await mk("Erik"), await mk("Olle"), await mk("Pia")];
  const other = await makeEmployee(db, { firstName: "Gun", lastName: "Z", category: category === "BOLLPLOCKARE" ? "GOLFSHOP" : "BOLLPLOCKARE" });
  const act = (u: { id: string }) => ({ id: u.id, role: category } as const);
  const shift = async (e: { employee: { id: string } }, date: string) => {
    const r = await createShift(db, admin, { employeeId: e.employee.id, date, from: "11:00", to: "15:00", publish: true, now: NOW });
    if (!r.ok) throw new Error("shift");
    return r.shiftId;
  };
  return { admin, adminUser, erik, olle, pia, other, eAct: act(erik.user!), oAct: act(olle.user!), pAct: act(pia.user!), shift };
}

describe("passbyte med utvald kollega (DIRECT)", () => {
  it("förfrågan → kollegan accepterar → Admin godkänner: ansvarig byts, historik och notiser skapas, passet är hela tiden bemannat", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Läkartid", now: NOW });
    expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id } })).status).toBe("AWAITING_COLLEAGUE");
    expect((await listMyNotifications(db, w.olle.user!.id)).some((n) => n.type === "SWAP_REQUESTED" && n.linkPath === `/bollplockare/byten/${id}`)).toBe(true);
    // inget ändras i schemat före godkännandet
    expect((await db.shift.findUniqueOrThrow({ where: { id: s } })).assignedEmployeeId).toBe(w.erik.employee.id);
    await expect(decideSwap(db, w.admin, id, { approve: true })).rejects.toThrow(/inte svarat/);

    await respondToSwap(db, w.oAct, id, { accept: true, comment: "Går bra", now: NOW });
    expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id } })).status).toBe("AWAITING_ADMIN");
    expect((await listMyNotifications(db, w.erik.user!.id)).some((n) => n.type === "SWAP_COLLEAGUE_ACCEPTED")).toBe(true);
    expect((await listMyNotifications(db, w.adminUser.id)).some((n) => n.type === "SWAP_REQUESTED")).toBe(true);

    await decideSwap(db, w.admin, id, { approve: true, comment: "Ok", now: NOW });
    const shift = await db.shift.findUniqueOrThrow({ where: { id: s } });
    expect([shift.assignedEmployeeId, shift.originalEmployeeId, shift.approvalStatus, shift.version]).toEqual([w.olle.employee.id, w.erik.employee.id, "APPROVED_AFTER_SWAP", 2]);
    const h = await db.shiftAssignmentHistory.findFirstOrThrow({ where: { reason: "SHIFT_SWAP" } });
    expect([h.fromEmployeeId, h.toEmployeeId, h.swapRequestId, h.changedById]).toEqual([w.erik.employee.id, w.olle.employee.id, id, w.adminUser.id]);
    for (const u of [w.erik.user!, w.olle.user!]) expect((await listMyNotifications(db, u.id)).some((n) => n.type === "SWAP_APPROVED")).toBe(true);
    expect(await db.auditLog.count({ where: { action: "SWAP_APPROVED" } })).toBe(1);
    await expect(decideSwap(db, w.admin, id, { approve: true })).rejects.toBeInstanceOf(ConflictError); // redan avgjort
  });

  it("nekas av Admin (anledning krävs) eller av kollegan: passet förblir hens", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Skola", now: NOW });
    await respondToSwap(db, w.oAct, id, { accept: true, now: NOW });
    await expect(decideSwap(db, w.admin, id, { approve: false })).rejects.toThrow(/anledning/);
    await decideSwap(db, w.admin, id, { approve: false, comment: "Behövs på passet", now: NOW });
    expect((await db.shift.findUniqueOrThrow({ where: { id: s } })).assignedEmployeeId).toBe(w.erik.employee.id);
    expect((await listMyNotifications(db, w.erik.user!.id)).find((n) => n.type === "SWAP_DENIED")?.body).toBe("Behövs på passet");

    const s2 = await w.shift(w.erik, B);
    const r2 = await createSwapRequest(db, w.eAct, { shiftId: s2, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Resa", now: NOW });
    await respondToSwap(db, w.oAct, r2.id, { accept: false, comment: "Kan inte", now: NOW });
    expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("DECLINED_BY_COLLEAGUE");
    expect((await listMyNotifications(db, w.erik.user!.id)).some((n) => n.type === "SWAP_COLLEAGUE_DECLINED")).toBe(true);
  });

  it("den som frågade kan avbryta före beslut; sedan kan ingen svara eller besluta", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Skola", now: NOW });
    await expect(cancelSwapRequest(db, w.oAct, id)).rejects.toBeInstanceOf(ForbiddenError); // bara den som frågade
    await cancelSwapRequest(db, w.eAct, id);
    expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    await expect(respondToSwap(db, w.oAct, id, { accept: true, now: NOW })).rejects.toBeInstanceOf(ConflictError);
    await expect(cancelSwapRequest(db, w.eAct, id)).rejects.toBeInstanceOf(ConflictError);
    // en ny förfrågan går att skicka efter avbrottet
    await createSwapRequest(db, w.eAct, { shiftId: s, kind: "OPEN", reason: "Öppen i stället", now: NOW });
  });

  it("regler: bara egna pass, bara samma grupp, inte sig själv, inte dubbelbokad kollega, bara ett öppet ärende per pass", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    await w.shift(w.olle, A); // Olle jobbar redan samma dag (krockar)
    await expect(createSwapRequest(db, w.oAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.pia.employee.id, reason: "Test", now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.other.employee.id, reason: "Fel grupp", now: NOW })).rejects.toThrow(/samma grupp/);
    await expect(createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.erik.employee.id, reason: "Mig själv", now: NOW })).rejects.toThrow();
    await expect(createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Krock", now: NOW })).rejects.toThrow(/krockar/);
    await expect(createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", reason: "Ingen vald", now: NOW })).rejects.toThrow(/kollega/);
    await expect(createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.pia.employee.id, reason: "", now: NOW })).rejects.toThrow(/anledning/);
    await createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.pia.employee.id, reason: "Pia kan", now: NOW });
    await expect(createSwapRequest(db, w.eAct, { shiftId: s, kind: "OPEN", reason: "Dubbelt", now: NOW })).rejects.toBeInstanceOf(ConflictError);
  });

  it("gamla, inställda och registrerade pass kan inte bytas", async () => {
    const w = await world();
    const past = await w.shift(w.erik, A);
    await expect(createSwapRequest(db, w.eAct, { shiftId: past, kind: "OPEN", reason: "För sent", now: new Date("2026-11-27T00:00:00Z") })).rejects.toThrow(/redan varit/);
    await db.shift.update({ where: { id: past }, data: { workStatus: "CANCELLED" } });
    await expect(createSwapRequest(db, w.eAct, { shiftId: past, kind: "OPEN", reason: "Inställt", now: NOW })).rejects.toThrow(/inställt/);
  });

  it("ändras passet efter förfrågan nekas godkännande (ingen tyst ändring av ett annat pass)", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Skola", now: NOW });
    await respondToSwap(db, w.oAct, id, { accept: true, now: NOW });
    await updateShift(db, w.admin, s, { employeeId: w.erik.employee.id, date: "2026-11-27", from: "11:00", to: "15:00", expectedVersion: 1, now: NOW });
    await expect(decideSwap(db, w.admin, id, { approve: true, now: NOW })).rejects.toThrow(/ändrats/);
  });

  it("endast Admin beslutar", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Skola", now: NOW });
    await respondToSwap(db, w.oAct, id, { accept: true, now: NOW });
    for (const a of [w.eAct, w.oAct, w.pAct]) await expect(decideSwap(db, a, id, { approve: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listSwapsForAdmin(db, w.eAct)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listSwapsForAdmin(db, w.admin, "AWAITING_ADMIN")).map((r) => r.requester)).toEqual(["Erik X"]);
  });
});

describe("öppen förfrågan, dagsbyte och ändringsbegäran", () => {
  it("öppen: hela gruppen notifieras, den första som tackar ja tar passet, två samtidiga ger exakt en vinnare", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "OPEN", reason: "Sjuk", now: NOW });
    for (const u of [w.olle.user!, w.pia.user!]) expect((await listMyNotifications(db, u.id)).some((n) => n.type === "SWAP_REQUESTED")).toBe(true);
    expect(await listMyNotifications(db, w.other.user!.id)).toHaveLength(0); // annan grupp
    expect((await listMySwaps(db, w.oAct, "BOLLPLOCKARE")).find((r) => r.id === id)?.needsMyAnswer).toBe(true);

    await respondToSwap(db, w.oAct, id, { accept: false, now: NOW }); // att tacka nej låter den ligga kvar
    expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id } })).status).toBe("AWAITING_COLLEAGUE");
    const results = await Promise.allSettled([respondToSwap(db, w.oAct, id, { accept: true, now: NOW }), respondToSwap(db, w.pAct, id, { accept: true, now: NOW })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const req = await db.shiftSwapRequest.findUniqueOrThrow({ where: { id } });
    expect([req.status, req.proposedEmployeeId !== null]).toEqual(["AWAITING_ADMIN", true]);
    await decideSwap(db, w.admin, id, { approve: true, now: NOW });
    expect((await db.shift.findUniqueOrThrow({ where: { id: s } })).assignedEmployeeId).toBe(req.proposedEmployeeId);
  });

  it("dagsbyte: Erik tar Olles pass och Olle tar Eriks, atomiskt och utan dubbelbokning", async () => {
    const w = await world();
    const sA = await w.shift(w.erik, A);
    const sB = await w.shift(w.olle, B);
    expect((await listColleagueShifts(db, w.eAct, "BOLLPLOCKARE", NOW)).map((x) => [x.date, x.employeeName])).toEqual([[B, "Olle X"]]);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: sA, kind: "EXCHANGE", counterShiftId: sB, reason: "Behöver ledigt onsdag", now: NOW });
    await expect(createSwapRequest(db, w.pAct, { shiftId: await w.shift(w.pia, "2026-11-30"), kind: "EXCHANGE", counterShiftId: sB, reason: "Samma pass", now: NOW })).rejects.toBeInstanceOf(ConflictError);
    await respondToSwap(db, w.oAct, id, { accept: true, now: NOW });
    await decideSwap(db, w.admin, id, { approve: true, now: NOW });
    const [a, b] = await Promise.all([db.shift.findUniqueOrThrow({ where: { id: sA } }), db.shift.findUniqueOrThrow({ where: { id: sB } })]);
    expect([a.assignedEmployeeId, b.assignedEmployeeId]).toEqual([w.olle.employee.id, w.erik.employee.id]);
    expect([a.originalEmployeeId, b.originalEmployeeId]).toEqual([w.erik.employee.id, w.olle.employee.id]); // ursprunglig ändras aldrig
    expect(await db.shiftAssignmentHistory.count({ where: { reason: "SHIFT_SWAP" } })).toBe(2);
    await expect(createSwapRequest(db, w.eAct, { shiftId: sA, kind: "EXCHANGE", counterShiftId: await w.shift(w.erik, "2026-12-01"), reason: "Eget pass", now: NOW })).rejects.toThrow();
  });

  it("dagsbyte på samma dag nekas, och dubbelbokning efter förfrågan stoppas vid godkännande", async () => {
    const w = await world();
    const sA = await w.shift(w.erik, A);
    const sA2 = await w.shift(w.olle, A);
    await expect(createSwapRequest(db, w.eAct, { shiftId: sA, kind: "EXCHANGE", counterShiftId: sA2, reason: "Samma dag", now: NOW })).rejects.toThrow(/annan dag/);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: sA, kind: "OPEN", reason: "Test", now: NOW });
    await respondToSwap(db, w.pAct, id, { accept: true, now: NOW });
    await w.shift(w.pia, A); // Pia får ett krockande pass efteråt
    await expect(decideSwap(db, w.admin, id, { approve: true, now: NOW })).rejects.toThrow(/krockande/);
    expect((await db.shift.findUniqueOrThrow({ where: { id: sA } })).assignedEmployeeId).toBe(w.erik.employee.id);
  });

  it("ändringsbegäran går direkt till Admin, markerar passet, och kan godkännas eller nekas", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "CHANGE", reason: "Kan inte före 21", now: NOW });
    expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id } })).status).toBe("AWAITING_ADMIN");
    expect((await db.shift.findUniqueOrThrow({ where: { id: s } })).approvalStatus).toBe("CHANGE_REQUESTED");
    expect((await listMyNotifications(db, w.adminUser.id)).find((n) => n.type === "SWAP_REQUESTED")?.linkPath).toBe(`/admin/passbyten/${id}`);
    await decideSwap(db, w.admin, id, { approve: true, comment: "Jag ändrar schemat", now: NOW });
    expect((await db.shift.findUniqueOrThrow({ where: { id: s } })).approvalStatus).toBe("PENDING");
    expect((await listMyNotifications(db, w.erik.user!.id)).some((n) => n.type === "SWAP_APPROVED")).toBe(true);
  });
});

describe("meddelanden och insyn", () => {
  it("bara deltagarna och Admin kan läsa och skriva; trådens historik är append-only", async () => {
    const w = await world();
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Skola", now: NOW });
    await postSwapMessage(db, w.oAct, id, "Vilken tid behöver du ledigt?");
    await postSwapMessage(db, w.admin, id, "Admin här");
    await expect(postSwapMessage(db, w.pAct, id, "Jag lyssnar")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(postSwapMessage(db, w.eAct, id, "   ")).rejects.toBeInstanceOf(ValidationError);
    await expect(getSwapDetail(db, w.pAct, id)).rejects.toBeInstanceOf(NotFoundError);
    const d = await getSwapDetail(db, w.eAct, id);
    expect(d.messages.map((m) => [m.author, m.body])).toEqual([["Erik X", "Skola"], ["Olle X", "Vilken tid behöver du ledigt?"], ["Adam", "Admin här"]]);
    expect([d.canCancel, d.canRespond, d.canDecide]).toEqual([true, false, false]);
    expect((await getSwapDetail(db, w.oAct, id)).canRespond).toBe(true);
    expect((await listMyNotifications(db, w.erik.user!.id)).some((n) => n.type === "SWAP_MESSAGE")).toBe(true);
    const m = await db.shiftSwapMessage.findFirstOrThrow();
    await expect(db.shiftSwapMessage.update({ where: { id: m.id }, data: { body: "ändrad" } })).rejects.toThrow(/append-only/);
    await expect(getSwapDetail(db, w.other.user ? { id: w.other.user.id, role: "GOLFSHOP" } : w.admin, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("kollegalistan innehåller bara aktiva i samma grupp, inte en själv", async () => {
    const w = await world();
    await db.employee.update({ where: { id: w.pia.employee.id }, data: { status: "INACTIVE" } });
    expect((await listColleagues(db, w.eAct, "BOLLPLOCKARE")).map((c) => c.name)).toEqual(["Olle X"]);
    await expect(listColleagues(db, { id: w.other.user!.id, role: "GOLFSHOP" }, "BOLLPLOCKARE")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("golfshop använder samma system, och bollplockare-passbyte efter incheckning nekas", () => {
  it("golfshop: byte mellan två i golfshopen går igenom samma flöde med golfshop-länkar", async () => {
    const w = await world("GOLFSHOP");
    const s = await w.shift(w.erik, A);
    const { id } = await createSwapRequest(db, w.eAct, { shiftId: s, kind: "DIRECT", proposedEmployeeId: w.olle.employee.id, reason: "Tandläkare", now: NOW });
    expect((await listMyNotifications(db, w.olle.user!.id))[0].linkPath).toBe(`/golfshop/byten/${id}`);
    await respondToSwap(db, w.oAct, id, { accept: true, now: NOW });
    await decideSwap(db, w.admin, id, { approve: true, now: NOW });
    expect((await db.shift.findUniqueOrThrow({ where: { id: s } })).assignedEmployeeId).toBe(w.olle.employee.id);
  });

  it("ett pass där bollplockaren redan klockat in kan inte bytas", async () => {
    const w = await world();
    const SW: Pt = [59.0, 15.0];
    const ring = [SW, offsetPoint(SW, 300, 0), offsetPoint(offsetPoint(SW, 300, 0), 400, 90), offsetPoint(SW, 400, 90)] as Pt[];
    await saveWorkArea(db, w.admin, { polygons: [ring.map((p) => [...p])], marginMeters: 40, expectedVersion: 0 });
    const s = await w.shift(w.erik, "2026-11-23");
    const p = interiorPoint([ring]);
    const at = new Date(localToInstant("2026-11-23", "19:45"));
    expect((await clockIn(db, w.eAct, { sample: { kind: "position", lat: p[0], lng: p[1], accuracyM: 5, fixAt: null }, now: at })).ok).toBe(true);
    await expect(createSwapRequest(db, w.eAct, { shiftId: s, kind: "OPEN", reason: "För sent", now: at })).rejects.toThrow(/tidsregistrering/);
  });
});

describe("den anställde godkänner sitt pass", () => {
  it("godkänner egna publicerade pass (versionen sparas), men inte andras, gamla eller inställda", async () => {
    const { approveMyShift } = await import("@/server/services/shift-response");
    const w = await world();
    const s = await w.shift(w.erik, A);
    await expect(approveMyShift(db, w.oAct, s, NOW)).rejects.toBeInstanceOf(NotFoundError); // någon annans pass
    await approveMyShift(db, w.eAct, s, NOW);
    await approveMyShift(db, w.eAct, s, NOW); // idempotent
    const shift = await db.shift.findUniqueOrThrow({ where: { id: s } });
    expect(shift.approvalStatus).toBe("APPROVED");
    expect(await db.shiftApproval.findMany({ where: { shiftId: s } })).toHaveLength(1);
    expect((await db.shiftApproval.findFirstOrThrow()).shiftVersion).toBe(shift.version);
    // ett väsentligt ändrat godkänt pass måste godkännas på nytt
    await updateShift(db, w.admin, s, { employeeId: w.erik.employee.id, date: B, from: "11:00", to: "15:00", expectedVersion: shift.version, confirmWarnings: true, now: NOW });
    expect((await db.shift.findUniqueOrThrow({ where: { id: s } })).approvalStatus).toBe("PENDING");
    await db.shift.update({ where: { id: s }, data: { workStatus: "CANCELLED" } });
    await expect(approveMyShift(db, w.eAct, s, NOW)).rejects.toThrow(/inställt/);
    const old = await w.shift(w.erik, "2026-11-22");
    await expect(approveMyShift(db, w.eAct, old, new Date("2026-11-23T12:00:00Z"))).rejects.toThrow(/redan varit/);
  });
});
