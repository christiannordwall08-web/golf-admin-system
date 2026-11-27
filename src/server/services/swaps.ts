import { isSwapAutoApprovable } from "@/domain/open-shifts";
import { type WorkCategory, can } from "@/domain/roles";
import { analyzeShift } from "@/domain/shifts";
import { dbDateToString, formatDateLong, localToInstant } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { fullName } from "@/server/queries/mappers";
import { adminUserIds, notify } from "./notifications";
import { eligibleRecipients, getSchedulingSettings } from "./open-shifts";
import type { Actor } from "./pay-rates";
import { overlappingShifts } from "./shifts";

/**
 * Passbyten (Golfshop och Bollplockare). Inget blir definitivt förrän Admin godkänt. Passet är alltid bemannat:
 * en förfrågan ändrar ingenting i schemat förrän godkännandet, och ett godkännande byter ansvarig i EN transaktion.
 *
 *  DIRECT   – be en utvald kollega ta passet.          Kollegan svarar → Admin beslutar.
 *  OPEN     – öppen förfrågan till hela gruppen.        Första som tackar ja tar det → Admin beslutar.
 *  EXCHANGE – byt arbetsdag med en kollega (två pass).  Kollegan svarar → Admin beslutar.
 *  CHANGE   – be Admin om en ändring (ingen kollega).   Admin beslutar.
 *
 * Automatiskt godkännande: har Admin slagit på `SchedulingSettings.autoApproveSwaps` godkänns DIRECT och OPEN direkt när
 * kollegan tackar ja, med EXAKT samma kontroller som när Admin godkänner (`applySwapApproval`). Bryts någon regel går
 * förfrågan till Admin som vanligt. EXCHANGE och CHANGE avgörs alltid av Admin.
 */
export type SwapKind = "DIRECT" | "OPEN" | "EXCHANGE" | "CHANGE";
type OpenStatus = "AWAITING_COLLEAGUE" | "AWAITING_ADMIN";
const OPEN_STATUSES: OpenStatus[] = ["AWAITING_COLLEAGUE", "AWAITING_ADMIN"];

const areaOf = (c: WorkCategory) => (c === "BOLLPLOCKARE" ? "bollplockare" : "golfshop");
const employeePath = (c: WorkCategory, id: string) => `/${areaOf(c)}/byten/${id}`;
const adminPath = (id: string) => `/admin/passbyten/${id}`;

async function myEmployee(db: DbClient, actor: Actor, category: WorkCategory) {
  if (!can(actor.role, "swap:request")) throw new ForbiddenError();
  const e = await db.employee.findFirst({ where: { userId: actor.id, category, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true } });
  if (!e) throw new ForbiddenError("Du har ingen aktiv anställning i den här gruppen.");
  return e;
}

const shiftLabel = (s: { localDate: Date; openEnded: boolean; startsAt: Date; endsAt: Date }) =>
  `${formatDateLong(localToInstant(dbDateToString(s.localDate), "12:00"))}${s.openEnded ? "" : ""}`;

/** Ett pass kan bytas om det ännu inte börjat/registrerats, inte är inställt och är publicerat. */
function assertSwappable(shift: { workStatus: string; publicationStatus: string; endsAt: Date; workTimeEntry: { id: string } | null; openEnded: boolean; localDate: Date }, now: Date, what = "Passet") {
  if (shift.workStatus === "CANCELLED") throw new ValidationError(`${what} är inställt.`);
  if (shift.publicationStatus !== "PUBLISHED") throw new ValidationError(`${what} är inte publicerat än.`);
  if (shift.workTimeEntry) throw new ValidationError(`${what} har redan en tidsregistrering.`);
  if (shift.endsAt <= now) throw new ValidationError(`${what} har redan varit.`);
}

const shiftWithEntry = (db: DbClient, id: string) => db.shift.findUnique({ where: { id }, include: { workTimeEntry: { select: { id: true } } } });

export type CreateSwapInput = {
  shiftId: string;
  kind: SwapKind;
  reason: string;
  proposedEmployeeId?: string | null;
  counterShiftId?: string | null;
  now?: Date;
};

export async function createSwapRequest(db: PrismaClient, actor: Actor, input: CreateSwapInput): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) throw new ValidationError("Skriv en kort anledning.");
  if (reason.length > 500) throw new ValidationError("Anledningen får vara högst 500 tecken.");

  const shift = await shiftWithEntry(db, input.shiftId);
  if (!shift) throw new NotFoundError("Passet finns inte.");
  const me = await myEmployee(db, actor, shift.category);
  if (shift.assignedEmployeeId !== me.id) throw new ForbiddenError("Du kan bara be om byte av dina egna pass.");
  assertSwappable(shift, now);

  let proposedEmployeeId: string | null = null;
  let counter: Awaited<ReturnType<typeof shiftWithEntry>> = null;
  if (input.kind === "DIRECT") {
    if (!input.proposedEmployeeId) throw new ValidationError("Välj en kollega.");
    proposedEmployeeId = input.proposedEmployeeId;
  } else if (input.kind === "EXCHANGE") {
    if (!input.counterShiftId) throw new ValidationError("Välj kollegans pass som du vill byta mot.");
    counter = await shiftWithEntry(db, input.counterShiftId);
    if (!counter) throw new NotFoundError("Kollegans pass finns inte.");
    if (counter.category !== shift.category) throw new ValidationError("Passen måste höra till samma grupp.");
    if (counter.assignedEmployeeId === me.id) throw new ValidationError("Välj ett pass som tillhör en kollega.");
    if (dbDateToString(counter.localDate) === dbDateToString(shift.localDate)) throw new ValidationError("Välj ett pass en annan dag.");
    assertSwappable(counter, now, "Kollegans pass");
    proposedEmployeeId = counter.assignedEmployeeId;
  }

  if (proposedEmployeeId) {
    const colleague = await db.employee.findUnique({ where: { id: proposedEmployeeId }, select: { id: true, category: true, status: true } });
    if (!colleague || colleague.category !== shift.category) throw new ValidationError("Kollegan måste tillhöra samma grupp.");
    if (colleague.status !== "ACTIVE") throw new ValidationError("Kollegan är inte aktiv.");
    if (colleague.id === me.id) throw new ValidationError("Du kan inte byta med dig själv.");
    // Kollegan får inte bli dubbelbokad av bytet.
    const clash = (await overlappingShifts(db, colleague.id, shift.startsAt, shift.endsAt)).filter((s) => s.workStatus !== "CANCELLED" && s.id !== counter?.id);
    if (clash.length > 0) throw new ValidationError("Kollegan har redan ett pass som krockar med det här.");
  }

  const status = input.kind === "CHANGE" ? "AWAITING_ADMIN" : "AWAITING_COLLEAGUE";
  try {
    return await db.$transaction(async (tx) => {
      const req = await tx.shiftSwapRequest.create({
        data: {
          shiftId: shift.id,
          requesterId: me.id,
          kind: input.kind,
          proposedEmployeeId,
          counterShiftId: counter?.id ?? null,
          reason,
          status,
          shiftVersionAtRequest: shift.version,
        },
      });
      await tx.shiftSwapMessage.create({ data: { requestId: req.id, authorId: actor.id, body: reason } });
      if (input.kind === "CHANGE") await tx.shift.update({ where: { id: shift.id }, data: { approvalStatus: "CHANGE_REQUESTED" } });
      await writeAudit(tx, { actorId: actor.id, action: "SWAP_REQUESTED", entityType: "ShiftSwapRequest", entityId: req.id, after: { kind: input.kind, shiftId: shift.id, proposedEmployeeId, counterShiftId: counter?.id ?? null } });

      const title = `${fullName(me)} ${input.kind === "CHANGE" ? "begär en ändring" : "vill byta pass"} ${shiftLabel(shift)}`;
      if (input.kind === "OPEN") {
        // Bara kollegor som faktiskt kan ta passet (aktiva, rätt grupp, ingen krock) får notisen.
        const group = await eligibleRecipients(tx, shift, now, [me.id]);
        await notify(tx, { userIds: group.flatMap((g) => (g.userId ? [g.userId] : [])), type: "SWAP_REQUESTED", title, body: `Öppen förfrågan. Anledning: ${reason}`, linkPath: employeePath(shift.category, req.id), entityType: "ShiftSwapRequest", entityId: req.id });
      } else if (proposedEmployeeId) {
        const c = await tx.employee.findUnique({ where: { id: proposedEmployeeId }, select: { userId: true } });
        if (c?.userId) await notify(tx, { userIds: [c.userId], type: "SWAP_REQUESTED", title, body: `Anledning: ${reason}`, linkPath: employeePath(shift.category, req.id), entityType: "ShiftSwapRequest", entityId: req.id });
      } else {
        await notify(tx, { userIds: await adminUserIds(tx), type: "SWAP_REQUESTED", title, body: `Anledning: ${reason}`, linkPath: adminPath(req.id), entityType: "ShiftSwapRequest", entityId: req.id });
      }
      return { id: req.id };
    });
  } catch (e) {
    if (/one_open_per_shift|one_open_per_counter_shift|23505/.test(e instanceof Error ? e.message : String(e))) {
      throw new ConflictError("Det finns redan en öppen förfrågan för det här passet.");
    }
    throw e;
  }
}

async function loadRequest(db: DbClient, id: string) {
  const r = await db.shiftSwapRequest.findUnique({
    where: { id },
    include: {
      shift: { include: { workTimeEntry: { select: { id: true } } } },
      counterShift: { include: { workTimeEntry: { select: { id: true } } } },
      requester: { select: { id: true, firstName: true, lastName: true, userId: true } },
      proposedEmployee: { select: { id: true, firstName: true, lastName: true, userId: true } },
    },
  });
  if (!r) throw new NotFoundError("Förfrågan finns inte.");
  return r;
}

/** Kollegan svarar. OPEN: den första som tackar ja tar över (atomiskt). */
export async function respondToSwap(db: PrismaClient, actor: Actor, requestId: string, input: { accept: boolean; comment?: string | null; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const r = await loadRequest(db, requestId);
  if (r.status !== "AWAITING_COLLEAGUE") throw new ConflictError("Förfrågan är inte längre öppen.");
  const me = await myEmployee(db, actor, r.shift.category);
  if (me.id === r.requesterId) throw new ForbiddenError("Du kan inte svara på din egen förfrågan.");
  if (r.kind === "DIRECT" || r.kind === "EXCHANGE") {
    if (r.proposedEmployeeId !== me.id) throw new ForbiddenError("Förfrågan gäller inte dig.");
  } else if (r.kind !== "OPEN") {
    throw new ValidationError("Den här förfrågan går direkt till Admin.");
  }
  if (!input.accept) {
    if (r.kind === "OPEN") return; // en avböjd öppen förfrågan ligger kvar för de andra
    await db.$transaction(async (tx) => {
      const { count } = await tx.shiftSwapRequest.updateMany({ where: { id: r.id, status: "AWAITING_COLLEAGUE" }, data: { status: "DECLINED_BY_COLLEAGUE", colleagueRespondedAt: now } });
      if (count === 0) throw new ConflictError("Förfrågan ändrades just nu.");
      if (input.comment?.trim()) await tx.shiftSwapMessage.create({ data: { requestId: r.id, authorId: actor.id, body: input.comment.trim().slice(0, 500) } });
      await writeAudit(tx, { actorId: actor.id, action: "SWAP_DECLINED_BY_COLLEAGUE", entityType: "ShiftSwapRequest", entityId: r.id });
      if (r.requester.userId) await notify(tx, { userIds: [r.requester.userId], type: "SWAP_COLLEAGUE_DECLINED", title: `${fullName(me)} kan inte byta`, body: input.comment?.trim() || null, linkPath: employeePath(r.shift.category, r.id), entityType: "ShiftSwapRequest", entityId: r.id });
    });
    return;
  }

  assertSwappable(r.shift, now);
  if (r.shift.version !== r.shiftVersionAtRequest) throw new ConflictError("Passet har ändrats sedan förfrågan skickades.");
  const clash = (await overlappingShifts(db, me.id, r.shift.startsAt, r.shift.endsAt)).filter((s) => s.workStatus !== "CANCELLED" && s.id !== r.counterShiftId);
  if (clash.length > 0) throw new ValidationError("Du har redan ett pass som krockar med det här.");

  const auto = isSwapAutoApprovable(r.kind, (await getSchedulingSettings(db)).autoApproveSwaps);
  const notifyAdmins = async (tx: DbClient) =>
    notify(tx, { userIds: await adminUserIds(tx), type: "SWAP_REQUESTED", title: `Passbyte att godkänna: ${fullName(r.requester)} → ${fullName(me)}`, body: `${shiftLabel(r.shift)}. Anledning: ${r.reason}`, linkPath: adminPath(r.id), entityType: "ShiftSwapRequest", entityId: r.id });

  await db.$transaction(async (tx) => {
    const { count } = await tx.shiftSwapRequest.updateMany({
      where: { id: r.id, status: "AWAITING_COLLEAGUE", ...(r.kind === "OPEN" ? { proposedEmployeeId: null } : {}) },
      data: { status: "AWAITING_ADMIN", proposedEmployeeId: me.id, colleagueRespondedAt: now },
    });
    if (count === 0) throw new ConflictError("Någon annan hann före, eller förfrågan ändrades.");
    if (input.comment?.trim()) await tx.shiftSwapMessage.create({ data: { requestId: r.id, authorId: actor.id, body: input.comment.trim().slice(0, 500) } });
    await writeAudit(tx, { actorId: actor.id, action: "SWAP_ACCEPTED_BY_COLLEAGUE", entityType: "ShiftSwapRequest", entityId: r.id, after: { employeeId: me.id } });
    const title = `${fullName(me)} kan ta passet ${shiftLabel(r.shift)}`;
    if (r.requester.userId) await notify(tx, { userIds: [r.requester.userId], type: "SWAP_COLLEAGUE_ACCEPTED", title, body: auto ? "Godkänns automatiskt om inga regler bryts." : "Väntar på Admins godkännande.", linkPath: employeePath(r.shift.category, r.id), entityType: "ShiftSwapRequest", entityId: r.id });
    if (!auto) await notifyAdmins(tx);
  });

  if (!auto) return;
  try {
    // Samma kontroller som när Admin godkänner. Ingen Admin är beslutsfattare: decidedById = null, revisionsloggen visar "system".
    await applySwapApproval(db, { deciderUserId: null, historyActorId: actor.id, comment: "Godkänt automatiskt (inga regler bröts)", now, auto: true }, await loadRequest(db, r.id));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    // Någon regel bröts (t.ex. krock som uppstått): låt Admin avgöra som vanligt.
    await db.$transaction(async (tx) => {
      await writeAudit(tx, { actorId: null, action: "SWAP_AUTO_APPROVAL_SKIPPED", entityType: "ShiftSwapRequest", entityId: r.id, metadata: { reason: e.message } });
      await notifyAdmins(tx);
    });
  }
}

/** Meddelande i tråden. Deltagare: den som frågar, kollegan, och Admin. */
export async function postSwapMessage(db: PrismaClient, actor: Actor, requestId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new ValidationError("Skriv ett meddelande.");
  if (text.length > 500) throw new ValidationError("Meddelandet får vara högst 500 tecken.");
  const r = await loadRequest(db, requestId);
  const isAdmin = can(actor.role, "swap:decide");
  const mine = await db.employee.findMany({ where: { userId: actor.id, category: r.shift.category }, select: { id: true } });
  const participant = isAdmin || mine.some((e) => e.id === r.requesterId || e.id === r.proposedEmployeeId);
  // En öppen förfrågan kan kommenteras av alla i gruppen som ännu inte tagit den.
  const openAudience = r.kind === "OPEN" && r.status === "AWAITING_COLLEAGUE" && mine.length > 0;
  if (!participant && !openAudience) throw new ForbiddenError();
  await db.$transaction(async (tx) => {
    await tx.shiftSwapMessage.create({ data: { requestId, authorId: actor.id, body: text } });
    const recipients = new Set<string>();
    if (r.requester.userId) recipients.add(r.requester.userId);
    if (r.proposedEmployee?.userId) recipients.add(r.proposedEmployee.userId);
    if (!r.proposedEmployee && r.kind === "CHANGE") for (const a of await adminUserIds(tx)) recipients.add(a);
    recipients.delete(actor.id);
    await notify(tx, { userIds: [...recipients], type: "SWAP_MESSAGE", title: "Nytt meddelande om passbyte", body: text.slice(0, 200), linkPath: employeePath(r.shift.category, requestId), entityType: "ShiftSwapRequest", entityId: requestId });
  });
}

/** Den som frågade kan avbryta så länge Admin inte beslutat. Passet förblir hens. */
export async function cancelSwapRequest(db: PrismaClient, actor: Actor, requestId: string): Promise<void> {
  const r = await loadRequest(db, requestId);
  const me = await myEmployee(db, actor, r.shift.category);
  if (r.requesterId !== me.id) throw new ForbiddenError("Bara den som skickade förfrågan kan avbryta den.");
  if (!OPEN_STATUSES.includes(r.status as OpenStatus)) throw new ConflictError("Förfrågan är redan avgjord.");
  await db.$transaction(async (tx) => {
    const { count } = await tx.shiftSwapRequest.updateMany({ where: { id: r.id, status: { in: OPEN_STATUSES } }, data: { status: "CANCELLED" } });
    if (count === 0) throw new ConflictError("Förfrågan ändrades just nu.");
    if (r.kind === "CHANGE") await tx.shift.updateMany({ where: { id: r.shiftId, approvalStatus: "CHANGE_REQUESTED" }, data: { approvalStatus: "PENDING" } });
    await writeAudit(tx, { actorId: actor.id, action: "SWAP_CANCELLED", entityType: "ShiftSwapRequest", entityId: r.id });
    const recipients = r.proposedEmployee?.userId ? [r.proposedEmployee.userId] : r.status === "AWAITING_ADMIN" ? await adminUserIds(tx) : [];
    await notify(tx, { userIds: recipients, type: "SWAP_CANCELLED", title: `${fullName(r.requester)} drog tillbaka sin förfrågan`, body: shiftLabel(r.shift), linkPath: employeePath(r.shift.category, r.id), entityType: "ShiftSwapRequest", entityId: r.id });
  });
}

/** Admin beslutar. Godkännande byter ansvarig atomiskt (dubbelbokning och obemannat pass är omöjliga). */
export async function decideSwap(db: PrismaClient, actor: Actor, requestId: string, input: { approve: boolean; comment?: string | null; now?: Date }): Promise<void> {
  if (!can(actor.role, "swap:decide")) throw new ForbiddenError("Endast Admin får besluta om passbyten.");
  const now = input.now ?? new Date();
  const comment = input.comment?.trim() || null;
  const r = await loadRequest(db, requestId);
  if (r.status !== "AWAITING_ADMIN") throw new ConflictError(r.status === "AWAITING_COLLEAGUE" ? "Kollegan har inte svarat än." : "Förfrågan är redan avgjord.");
  if (!input.approve && !comment) throw new ValidationError("Ange en anledning när du nekar.");

  if (!input.approve) {
    await db.$transaction(async (tx) => {
      const { count } = await tx.shiftSwapRequest.updateMany({ where: { id: r.id, status: "AWAITING_ADMIN" }, data: { status: "DENIED", decidedById: actor.id, decidedAt: now, adminComment: comment } });
      if (count === 0) throw new ConflictError();
      if (r.kind === "CHANGE") await tx.shift.updateMany({ where: { id: r.shiftId, approvalStatus: "CHANGE_REQUESTED" }, data: { approvalStatus: "PENDING" } });
      await writeAudit(tx, { actorId: actor.id, action: "SWAP_DENIED", entityType: "ShiftSwapRequest", entityId: r.id, metadata: { comment } });
      await notify(tx, { userIds: [r.requester.userId, r.proposedEmployee?.userId].flatMap((u) => (u ? [u] : [])), type: "SWAP_DENIED", title: `Passbytet ${shiftLabel(r.shift)} nekades`, body: comment, linkPath: employeePath(r.shift.category, r.id), entityType: "ShiftSwapRequest", entityId: r.id });
    });
    return;
  }

  if (r.kind === "CHANGE") {
    await db.$transaction(async (tx) => {
      const { count } = await tx.shiftSwapRequest.updateMany({ where: { id: r.id, status: "AWAITING_ADMIN" }, data: { status: "APPROVED", decidedById: actor.id, decidedAt: now, adminComment: comment } });
      if (count === 0) throw new ConflictError();
      await tx.shift.updateMany({ where: { id: r.shiftId, approvalStatus: "CHANGE_REQUESTED" }, data: { approvalStatus: "PENDING" } });
      await writeAudit(tx, { actorId: actor.id, action: "SWAP_APPROVED", entityType: "ShiftSwapRequest", entityId: r.id, metadata: { kind: "CHANGE", comment } });
      if (r.requester.userId) await notify(tx, { userIds: [r.requester.userId], type: "SWAP_APPROVED", title: "Din ändringsbegäran är godkänd", body: comment ?? "Admin uppdaterar schemat.", linkPath: employeePath(r.shift.category, r.id), entityType: "ShiftSwapRequest", entityId: r.id });
    });
    return;
  }

  await applySwapApproval(db, { deciderUserId: actor.id, historyActorId: actor.id, comment, now, auto: false }, r);
}

type LoadedRequest = Awaited<ReturnType<typeof loadRequest>>;

/**
 * Byte av ansvarig person: kontrollera allt igen och byt ansvarig atomiskt. Används både när Admin godkänner och vid
 * automatiskt godkännande, så reglerna är exakt desamma. `deciderUserId` = Admin, eller null när systemet godkänner.
 */
async function applySwapApproval(
  db: PrismaClient,
  opts: { deciderUserId: string | null; historyActorId: string; comment: string | null; now: Date; auto: boolean },
  r: LoadedRequest,
): Promise<void> {
  const { deciderUserId, historyActorId, comment, now, auto } = opts;
  if (r.status !== "AWAITING_ADMIN") throw new ConflictError("Förfrågan är redan avgjord.");
  if (r.kind === "CHANGE") throw new ValidationError("En ändringsbegäran byter inte ansvarig.");
  if (!r.proposedEmployee) throw new ValidationError("Ingen kollega har tagit passet.");
  assertSwappable(r.shift, now);
  if (r.shift.version !== r.shiftVersionAtRequest) throw new ConflictError("Passet har ändrats sedan förfrågan skickades. Be om en ny förfrågan.");
  if (r.shift.assignedEmployeeId !== r.requesterId) throw new ConflictError("Passet tillhör inte längre den som frågade.");
  const colleague = await db.employee.findUniqueOrThrow({ where: { id: r.proposedEmployee.id }, select: { id: true, category: true, status: true } });
  const exchange = r.kind === "EXCHANGE" ? r.counterShift : null;
  if (r.kind === "EXCHANGE") {
    if (!exchange) throw new ValidationError("Kollegans pass saknas.");
    assertSwappable(exchange, now, "Kollegans pass");
    if (exchange.assignedEmployeeId !== colleague.id) throw new ConflictError("Kollegans pass har bytt ansvarig.");
  }
  const checkOverlap = async (employeeId: string, s: { startsAt: Date; endsAt: Date; category: WorkCategory }, ignore: string[]) => {
    const issues = analyzeShift({
      candidate: { category: s.category, assignedEmployeeId: employeeId, startsAt: s.startsAt, endsAt: s.endsAt },
      employee: { id: employeeId, category: s.category, status: "ACTIVE" },
      otherShiftsOfEmployee: (await overlappingShifts(db, employeeId, s.startsAt, s.endsAt)).filter((x) => !ignore.includes(x.id)),
    });
    return issues.filter((i) => i.code === "OVERLAP");
  };
  if (colleague.status !== "ACTIVE") throw new ValidationError("Kollegan är inte aktiv.");
  const ignore = [r.shiftId, ...(exchange ? [exchange.id] : [])];
  if ((await checkOverlap(colleague.id, r.shift, ignore)).length) throw new ConflictError("Kollegan har fått ett krockande pass sedan förfrågan.");
  if (exchange && (await checkOverlap(r.requesterId, exchange, ignore)).length) throw new ConflictError("Den som frågade har fått ett krockande pass sedan förfrågan.");

  await db.$transaction(async (tx) => {
    // Vid dagsbyte byter två pass ägare "samtidigt": skjut upp överlappskontrollen till slutet av transaktionen.
    await tx.$executeRawUnsafe('SET CONSTRAINTS "Shift_no_overlap_per_employee" DEFERRED');
    const { count } = await tx.shiftSwapRequest.updateMany({ where: { id: r.id, status: "AWAITING_ADMIN" }, data: { status: "APPROVED", decidedById: deciderUserId, decidedAt: now, adminComment: comment } });
    if (count === 0) throw new ConflictError();
    const move = async (shiftId: string, version: number, fromId: string, toId: string) => {
      const u = await tx.shift.updateMany({ where: { id: shiftId, version, assignedEmployeeId: fromId }, data: { assignedEmployeeId: toId, approvalStatus: "APPROVED_AFTER_SWAP", version: { increment: 1 } } });
      if (u.count === 0) throw new ConflictError("Passet ändrades just nu.");
      await tx.shiftAssignmentHistory.create({ data: { shiftId, fromEmployeeId: fromId, toEmployeeId: toId, reason: "SHIFT_SWAP", swapRequestId: r.id, changedById: historyActorId, comment } });
    };
    await move(r.shiftId, r.shift.version, r.requesterId, colleague.id);
    if (exchange) await move(exchange.id, exchange.version, colleague.id, r.requesterId);
    await writeAudit(tx, { actorId: deciderUserId, action: "SWAP_APPROVED", entityType: "ShiftSwapRequest", entityId: r.id, metadata: { kind: r.kind, shiftId: r.shiftId, counterShiftId: exchange?.id ?? null, from: r.requesterId, to: colleague.id, auto } });
    const link = (c: WorkCategory) => (c === "BOLLPLOCKARE" ? "/bollplockare/schema" : "/golfshop/schema");
    await notify(tx, { userIds: [r.requester.userId].flatMap((u) => (u ? [u] : [])), type: "SWAP_APPROVED", title: `Passbytet ${shiftLabel(r.shift)} är godkänt`, body: exchange ? `Du tar ${shiftLabel(exchange)} i stället.` : `${fullName(r.proposedEmployee!)} tar passet.`, linkPath: link(r.shift.category), entityType: "ShiftSwapRequest", entityId: r.id });
    await notify(tx, { userIds: [r.proposedEmployee!.userId].flatMap((u) => (u ? [u] : [])), type: "SWAP_APPROVED", title: `Du har tagit över passet ${shiftLabel(r.shift)}`, body: exchange ? `Du lämnar ${shiftLabel(exchange)}.` : "Se ditt schema.", linkPath: link(r.shift.category), entityType: "ShiftSwapRequest", entityId: r.id });
    if (auto) {
      await notify(tx, { userIds: await adminUserIds(tx), type: "SWAP_APPROVED", title: `Passbyte godkänt automatiskt: ${fullName(r.requester)} → ${fullName(r.proposedEmployee!)}`, body: shiftLabel(r.shift), linkPath: adminPath(r.id), entityType: "ShiftSwapRequest", entityId: r.id });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Läsning
// ---------------------------------------------------------------------------------------------------------------------

export type SwapRow = {
  id: string;
  kind: SwapKind;
  status: "AWAITING_COLLEAGUE" | "AWAITING_ADMIN" | "DECLINED_BY_COLLEAGUE" | "APPROVED" | "DENIED" | "CANCELLED";
  category: WorkCategory;
  requester: string;
  colleague: string | null;
  shiftDate: string;
  counterDate: string | null;
  reason: string;
  adminComment: string | null;
  createdAt: Date;
  /** Förhållande till den inloggade: skickad av mig, väntar på mig, eller bara visning. */
  mine: boolean;
  needsMyAnswer: boolean;
};

const rowInclude = {
  shift: { select: { category: true, localDate: true } },
  counterShift: { select: { localDate: true } },
  requester: { select: { firstName: true, lastName: true, userId: true } },
  proposedEmployee: { select: { firstName: true, lastName: true, userId: true } },
} as const;

type RowRecord = NonNullable<Awaited<ReturnType<typeof loadRows>>>[number];
const loadRows = (db: DbClient, where: object) =>
  db.shiftSwapRequest.findMany({ where, include: rowInclude, orderBy: { createdAt: "desc" }, take: 100 });

function toRow(r: RowRecord, userId: string): SwapRow {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    category: r.shift.category,
    requester: fullName(r.requester),
    colleague: r.proposedEmployee ? fullName(r.proposedEmployee) : null,
    shiftDate: dbDateToString(r.shift.localDate),
    counterDate: r.counterShift ? dbDateToString(r.counterShift.localDate) : null,
    reason: r.reason,
    adminComment: r.adminComment,
    createdAt: r.createdAt,
    mine: r.requester.userId === userId,
    needsMyAnswer: r.status === "AWAITING_COLLEAGUE" && r.requester.userId !== userId && (r.kind === "OPEN" || r.proposedEmployee?.userId === userId),
  };
}

/** Den inloggades egna förfrågningar och sådana som väntar på svar från hen (i en arbetsgrupp). */
export async function listMySwaps(db: DbClient, actor: Actor, category: WorkCategory): Promise<SwapRow[]> {
  const me = await myEmployee(db, actor, category);
  const rows = await loadRows(db, {
    shift: { category },
    OR: [{ requesterId: me.id }, { proposedEmployeeId: me.id }, { kind: "OPEN", status: "AWAITING_COLLEAGUE" }],
  });
  return rows.map((r) => toRow(r, actor.id));
}

export async function listSwapsForAdmin(db: DbClient, actor: Actor, status?: SwapRow["status"]): Promise<SwapRow[]> {
  if (!can(actor.role, "swap:read:all")) throw new ForbiddenError();
  return (await loadRows(db, status ? { status } : {})).map((r) => toRow(r, actor.id));
}

export async function getSwapDetail(db: DbClient, actor: Actor, id: string) {
  const r = await loadRequest(db, id);
  const isAdmin = can(actor.role, "swap:read:all");
  const mine = await db.employee.findMany({ where: { userId: actor.id, category: r.shift.category }, select: { id: true } });
  const participant = mine.some((e) => e.id === r.requesterId || e.id === r.proposedEmployeeId);
  const openAudience = r.kind === "OPEN" && r.status === "AWAITING_COLLEAGUE" && mine.length > 0;
  if (!isAdmin && !participant && !openAudience) throw new NotFoundError("Förfrågan finns inte.");
  const messages = await db.shiftSwapMessage.findMany({ where: { requestId: id }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, role: true, employees: { select: { firstName: true, lastName: true } } } } } });
  return {
    row: toRow({ ...r, shift: { category: r.shift.category, localDate: r.shift.localDate }, counterShift: r.counterShift ? { localDate: r.counterShift.localDate } : null } as RowRecord, actor.id),
    shiftId: r.shiftId,
    version: r.shift.version,
    messages: messages.map((m) => ({
      id: m.id,
      at: m.createdAt,
      body: m.body,
      mine: m.authorId === actor.id,
      author: m.author.role === "ADMIN" ? (m.author.name ?? "Admin") : m.author.employees[0] ? fullName(m.author.employees[0]) : "Okänd",
      isAdmin: m.author.role === "ADMIN",
    })),
    canRespond: r.status === "AWAITING_COLLEAGUE" && toRow({ ...r, shift: { category: r.shift.category, localDate: r.shift.localDate }, counterShift: null } as RowRecord, actor.id).needsMyAnswer,
    canCancel: OPEN_STATUSES.includes(r.status as OpenStatus) && r.requester.userId === actor.id,
    canDecide: isAdmin && r.status === "AWAITING_ADMIN" && can(actor.role, "swap:decide"),
  };
}

/** Kollegor som kan föreslås: aktiva i gruppen utom en själv. */
export async function listColleagues(db: DbClient, actor: Actor, category: WorkCategory) {
  const me = await myEmployee(db, actor, category);
  const rows = await db.employee.findMany({ where: { category, status: "ACTIVE", id: { not: me.id } }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ firstName: "asc" }] });
  return rows.map((e) => ({ id: e.id, name: fullName(e) }));
}

/** Kollegors kommande pass (för dagsbyte): publicerade, ej inställda, ej registrerade. */
export async function listColleagueShifts(db: DbClient, actor: Actor, category: WorkCategory, now = new Date()) {
  const me = await myEmployee(db, actor, category);
  const rows = await db.shift.findMany({
    where: { category, assignedEmployeeId: { not: me.id }, publicationStatus: "PUBLISHED", workStatus: { not: "CANCELLED" }, endsAt: { gt: now }, workTimeEntry: null },
    include: { assignedEmployee: { select: { firstName: true, lastName: true } } },
    orderBy: { startsAt: "asc" },
    take: 60,
  });
  return rows.map((s) => ({ id: s.id, date: dbDateToString(s.localDate), employeeName: fullName(s.assignedEmployee) }));
}
