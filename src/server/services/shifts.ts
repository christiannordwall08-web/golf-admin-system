import { can } from "@/domain/roles";
import type { WorkCategory } from "@/domain/roles";
import {
  type ShiftIssue,
  analyzeShift,
  buildShiftInterval,
  isApproved,
  isMaterialShiftChange,
} from "@/domain/shifts";
import { dateStringToDbDate, stockholmDateOf, stockholmYearMonth } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { getRangeDay } from "@/modules/bollplockare/server/settings";
import { openEndedWindow } from "@/modules/bollplockare/domain/range-time";
import { notify } from "./notifications";
import type { Actor } from "./pay-rates";

/** Intervallet för ett pass utan fast sluttid (bollplockare): från tidigaste incheckning, utan arbetad sluttid. */
async function openEndedInterval(db: DbClient, date: string): Promise<{ ok: true; startsAt: Date; endsAt: Date } | { ok: false; issue: ShiftIssue }> {
  const window = openEndedWindow(await getRangeDay(db, date));
  if (!window) {
    return { ok: false, issue: { code: "INVALID_TIMES", severity: "error", message: "Rangen är stängd den dagen. Bollplockare kan inte schemaläggas då." } };
  }
  return { ok: true, ...window };
}

/**
 * Skapa, ändra, ställa in, återställa och publicera pass (Admin).
 *
 * Regler (alla på servern):
 *  - Endast Admin (`schedule:write`, publicering `schedule:publish`). Behörighet kontrolleras FÖRST.
 *  - Varje pass har en ansvarig anställd i rätt arbetskategori. Ingen dubbelbokning (kontroll här + exclusion constraint i databasen).
 *  - Pass raderas aldrig: de ställs in ("Inställt"). Historiken är oföränderlig.
 *  - Pass med tidsregistrering kan inte ändras här (korrigering av arbetstid hör till Etapp 4).
 *  - Ändras ett redan godkänt pass väsentligt (person/tid) krävs nytt godkännande (approvalStatus -> PENDING), efter bekräftelse.
 *  - Ändring av ansvarig loggas i ShiftAssignmentHistory; `originalEmployeeId` ändras aldrig.
 *  - Samtidiga ändringar: `version` (optimistisk låsning) -> ConflictError.
 *  - Allt skrivs i en transaktion tillsammans med revisionsloggen.
 */

export type ShiftInput = {
  employeeId: string;
  /** Stockholm-datum "YYYY-MM-DD" när passet börjar. */
  date: string;
  /** "HH:mm" (Stockholm-tid). */
  from: string;
  to: string;
  endsNextDay?: boolean;
  notes?: string | null;
};

export type ShiftWriteResult =
  | { ok: true; shiftId: string; category: WorkCategory; startsAt: Date }
  | {
      ok: false;
      issues: ShiftIssue[];
      /** true = bara varningar: spara igen med confirmWarnings för att gå vidare. */
      needsConfirm: boolean;
    };

export const OVERLAP_ISSUE: ShiftIssue = {
  code: "OVERLAP",
  severity: "error",
  message: "Den anställde har redan ett överlappande pass. Ladda om sidan och försök igen.",
};

export function isOverlapViolation(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e);
  return /Shift_no_overlap_per_employee|23P01/.test(text);
}

function assertCan(actor: Actor, permission: Parameters<typeof can>[1]): void {
  if (!can(actor.role, permission)) throw new ForbiddenError("Endast Admin får ändra schemat.");
}

/** Fel blockerar. Bara varningar kräver bekräftelse. Returnerar null om det är fritt fram. */
export function gate(issues: ShiftIssue[], confirm: boolean | undefined): Extract<ShiftWriteResult, { ok: false }> | null {
  if (issues.some((i) => i.severity === "error")) return { ok: false, issues, needsConfirm: false };
  if (issues.length > 0 && !confirm) return { ok: false, issues, needsConfirm: true };
  return null;
}

export async function overlappingShifts(db: DbClient, employeeId: string, startsAt: Date, endsAt: Date) {
  return db.shift.findMany({
    where: { assignedEmployeeId: employeeId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    select: { id: true, startsAt: true, endsAt: true, workStatus: true },
  });
}

export async function scheduleFor(db: DbClient, category: WorkCategory, startsAt: Date) {
  const { year, month } = stockholmYearMonth(startsAt);
  return db.schedule.upsert({
    where: { category_year_month: { category, year, month } },
    create: { category, year, month },
    update: {},
  });
}

export const PAST_WARNING: ShiftIssue = {
  code: "ALREADY_ENDED",
  severity: "warning",
  message:
    "Passet har redan tagit slut (eller hamnar i det förflutna). Ändringen påverkar genomförda timmar och preliminär ersättning.",
};

export async function createShift(
  db: PrismaClient,
  actor: Actor,
  input: ShiftInput & { publish?: boolean; confirmWarnings?: boolean; now?: Date },
): Promise<ShiftWriteResult> {
  assertCan(actor, "schedule:write");
  if (input.publish) assertCan(actor, "schedule:publish");
  const now = input.now ?? new Date();

  const employee = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, category: true, status: true },
  });
  if (!employee) throw new NotFoundError("Den anställde finns inte.");

  // Bollplockare har inga fasta tider: passet utgår från rangens stängningstid och admin anger aldrig en sluttid.
  const openEnded = employee.category === "BOLLPLOCKARE";
  const interval = openEnded ? await openEndedInterval(db, input.date) : buildShiftInterval(input);
  if (!interval.ok) return { ok: false, issues: [interval.issue], needsConfirm: false };
  const { startsAt, endsAt } = interval;

  const issues = analyzeShift({
    candidate: { category: employee.category, assignedEmployeeId: employee.id, startsAt, endsAt },
    employee,
    otherShiftsOfEmployee: await overlappingShifts(db, employee.id, startsAt, endsAt),
  });
  if (endsAt <= now) issues.push(PAST_WARNING);
  const blocked = gate(issues, input.confirmWarnings);
  if (blocked) return blocked;

  try {
    return await db.$transaction(async (tx) => {
      const schedule = await scheduleFor(tx, employee.category, startsAt);
      if (input.publish && schedule.status !== "PUBLISHED") {
        await tx.schedule.update({ where: { id: schedule.id }, data: { status: "PUBLISHED", publishedAt: now } });
      }
      const shift = await tx.shift.create({
        data: {
          scheduleId: schedule.id,
          category: employee.category,
          assignedEmployeeId: employee.id,
          originalEmployeeId: employee.id,
          startsAt,
          endsAt,
          localDate: dateStringToDbDate(openEnded ? input.date : stockholmDateOf(startsAt)),
          publicationStatus: input.publish ? "PUBLISHED" : "DRAFT",
          openEnded,
          notes: input.notes?.trim() || null,
          createdById: actor.id,
        },
      });
      await tx.shiftAssignmentHistory.create({
        data: { shiftId: shift.id, toEmployeeId: employee.id, reason: "INITIAL", changedById: actor.id },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "SHIFT_CREATED",
        entityType: "Shift",
        entityId: shift.id,
        after: {
          employeeId: employee.id,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          publicationStatus: shift.publicationStatus,
        },
      });
      return { ok: true as const, shiftId: shift.id, category: employee.category, startsAt };
    });
  } catch (e) {
    if (isOverlapViolation(e)) return { ok: false, issues: [OVERLAP_ISSUE], needsConfirm: false };
    throw e;
  }
}

export async function updateShift(
  db: PrismaClient,
  actor: Actor,
  shiftId: string,
  input: ShiftInput & { expectedVersion: number; confirmWarnings?: boolean; now?: Date },
): Promise<ShiftWriteResult> {
  assertCan(actor, "schedule:write");
  const now = input.now ?? new Date();

  const existing = await db.shift.findUnique({ where: { id: shiftId }, include: { workTimeEntry: { select: { id: true } } } });
  if (!existing) throw new NotFoundError("Passet finns inte.");

  const blockers: ShiftIssue[] = [];
  if (existing.workStatus === "CANCELLED") {
    blockers.push({ code: "SHIFT_CANCELLED", severity: "error", message: "Passet är inställt. Återställ det först om det ska ändras." });
  }
  if (existing.workTimeEntry) {
    blockers.push({
      code: "HAS_TIME_ENTRY",
      severity: "error",
      message: "Passet har en tidsregistrering och kan inte ändras här. Arbetstid korrigeras i ett separat flöde (Etapp 4).",
    });
  }
  if (blockers.length) return { ok: false, issues: blockers, needsConfirm: false };
  if (existing.version !== input.expectedVersion) throw new ConflictError();

  const employee = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, category: true, status: true },
  });
  if (!employee) throw new NotFoundError("Den anställde finns inte.");

  // Pass utan fast sluttid ändras bara på datum, person och notering: tiderna följer rangens stängningstid.
  const interval = existing.openEnded ? await openEndedInterval(db, input.date) : buildShiftInterval(input);
  if (!interval.ok) return { ok: false, issues: [interval.issue], needsConfirm: false };
  const { startsAt, endsAt } = interval;
  const notes = input.notes?.trim() || null;

  const previous = {
    startsAt: existing.startsAt,
    endsAt: existing.endsAt,
    category: existing.category,
    assignedEmployeeId: existing.assignedEmployeeId,
    approvalStatus: existing.approvalStatus,
  };
  const next = { startsAt, endsAt, category: existing.category, assignedEmployeeId: employee.id };
  const material = isMaterialShiftChange(previous, next);
  if (!material && notes === existing.notes) {
    return { ok: true, shiftId: existing.id, category: existing.category, startsAt: existing.startsAt }; // inget ändrat
  }

  const issues = analyzeShift({
    candidate: { id: existing.id, ...next, category: existing.category },
    employee,
    otherShiftsOfEmployee: await overlappingShifts(db, employee.id, startsAt, endsAt),
    previous,
  });
  if (material && (existing.endsAt <= now || endsAt <= now)) issues.push(PAST_WARNING);
  const blocked = gate(issues, input.confirmWarnings);
  if (blocked) return blocked;

  // Väsentlig ändring av ett godkänt pass kräver nytt godkännande.
  const resetApproval = material && isApproved(existing.approvalStatus);

  try {
    return await db.$transaction(async (tx) => {
      const schedule = await scheduleFor(tx, existing.category, startsAt);
      const { count } = await tx.shift.updateMany({
        where: { id: existing.id, version: input.expectedVersion },
        data: {
          assignedEmployeeId: employee.id,
          startsAt,
          endsAt,
          localDate: dateStringToDbDate(existing.openEnded ? input.date : stockholmDateOf(startsAt)),
          scheduleId: schedule.id,
          notes,
          ...(resetApproval ? { approvalStatus: "PENDING" as const } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw new ConflictError();

      if (employee.id !== existing.assignedEmployeeId) {
        await tx.shiftAssignmentHistory.create({
          data: {
            shiftId: existing.id,
            fromEmployeeId: existing.assignedEmployeeId,
            toEmployeeId: employee.id,
            reason: "ADMIN_REASSIGNMENT",
            changedById: actor.id,
          },
        });
      }
      if (existing.publicationStatus === "PUBLISHED" && material) {
        const users = await tx.employee.findMany({ where: { id: { in: [existing.assignedEmployeeId, employee.id] } }, select: { userId: true } });
        const label = `${input.date}${existing.openEnded ? "" : ` ${input.from.replace(":", ".")}–${input.to.replace(":", ".")}`}`;
        await notify(tx, {
          userIds: users.flatMap((u) => (u.userId ? [u.userId] : [])),
          type: "SHIFT_CHANGED",
          title: employee.id === existing.assignedEmployeeId ? `Ändrat pass ${label}` : `Ändrad bemanning ${label}`,
          body: "Schemat har ändrats. Se ditt schema.",
          linkPath: existing.category === "BOLLPLOCKARE" ? "/bollplockare/schema" : "/golfshop/schema",
          entityType: "Shift",
          entityId: existing.id,
        });
      }
      await writeAudit(tx, {
        actorId: actor.id,
        action: "SHIFT_UPDATED",
        entityType: "Shift",
        entityId: existing.id,
        before: {
          employeeId: existing.assignedEmployeeId,
          startsAt: existing.startsAt.toISOString(),
          endsAt: existing.endsAt.toISOString(),
          notes: existing.notes,
          approvalStatus: existing.approvalStatus,
        },
        after: {
          employeeId: employee.id,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          notes,
          approvalStatus: resetApproval ? "PENDING" : existing.approvalStatus,
        },
      });
      return { ok: true as const, shiftId: existing.id, category: existing.category, startsAt };
    });
  } catch (e) {
    if (isOverlapViolation(e)) return { ok: false, issues: [OVERLAP_ISSUE], needsConfirm: false };
    throw e;
  }
}

/** Ställer in ett pass ("Inställt"). Passet raderas aldrig; det räknas inte längre som arbetstid. */
export async function cancelShift(
  db: PrismaClient,
  actor: Actor,
  shiftId: string,
  input: { expectedVersion: number; reason?: string | null; confirmWarnings?: boolean; now?: Date },
): Promise<ShiftWriteResult> {
  assertCan(actor, "schedule:write");
  const now = input.now ?? new Date();
  const existing = await db.shift.findUnique({ where: { id: shiftId }, include: { workTimeEntry: { select: { id: true } } } });
  if (!existing) throw new NotFoundError("Passet finns inte.");
  if (existing.workStatus === "CANCELLED") {
    return { ok: false, issues: [{ code: "SHIFT_CANCELLED", severity: "error", message: "Passet är redan inställt." }], needsConfirm: false };
  }
  if (existing.workTimeEntry) {
    return { ok: false, issues: [{ code: "HAS_TIME_ENTRY", severity: "error", message: "Passet har en tidsregistrering och kan inte ställas in här." }], needsConfirm: false };
  }
  if (existing.version !== input.expectedVersion) throw new ConflictError();
  const blocked = gate(existing.endsAt <= now ? [PAST_WARNING] : [], input.confirmWarnings);
  if (blocked) return blocked;

  await db.$transaction(async (tx) => {
    const { count } = await tx.shift.updateMany({
      where: { id: existing.id, version: input.expectedVersion },
      data: { workStatus: "CANCELLED", cancelledAt: now, version: { increment: 1 } },
    });
    if (count === 0) throw new ConflictError();
    await writeAudit(tx, {
      actorId: actor.id,
      action: "SHIFT_CANCELLED",
      entityType: "Shift",
      entityId: existing.id,
      before: { workStatus: existing.workStatus },
      after: { workStatus: "CANCELLED" },
      metadata: input.reason ? { reason: input.reason.slice(0, 200) } : undefined,
    });
  });
  return { ok: true, shiftId: existing.id, category: existing.category, startsAt: existing.startsAt };
}

/** Återställer ett inställt pass (om personen inte hunnit få ett överlappande pass). */
export async function restoreShift(
  db: PrismaClient,
  actor: Actor,
  shiftId: string,
  input: { expectedVersion: number; confirmWarnings?: boolean; now?: Date },
): Promise<ShiftWriteResult> {
  assertCan(actor, "schedule:write");
  const now = input.now ?? new Date();
  const existing = await db.shift.findUnique({ where: { id: shiftId }, include: { assignedEmployee: { select: { id: true, category: true, status: true } } } });
  if (!existing) throw new NotFoundError("Passet finns inte.");
  if (existing.workStatus !== "CANCELLED") {
    return { ok: false, issues: [{ code: "SHIFT_CANCELLED", severity: "error", message: "Passet är inte inställt." }], needsConfirm: false };
  }
  if (existing.version !== input.expectedVersion) throw new ConflictError();

  const issues = analyzeShift({
    candidate: { id: existing.id, category: existing.category, assignedEmployeeId: existing.assignedEmployeeId, startsAt: existing.startsAt, endsAt: existing.endsAt },
    employee: existing.assignedEmployee,
    otherShiftsOfEmployee: await overlappingShifts(db, existing.assignedEmployeeId, existing.startsAt, existing.endsAt),
  });
  if (existing.endsAt <= now) issues.push(PAST_WARNING);
  const blocked = gate(issues, input.confirmWarnings);
  if (blocked) return blocked;

  try {
    await db.$transaction(async (tx) => {
      const { count } = await tx.shift.updateMany({
        where: { id: existing.id, version: input.expectedVersion },
        data: { workStatus: "SCHEDULED", cancelledAt: null, version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictError();
      await writeAudit(tx, {
        actorId: actor.id,
        action: "SHIFT_RESTORED",
        entityType: "Shift",
        entityId: existing.id,
        before: { workStatus: "CANCELLED" },
        after: { workStatus: "SCHEDULED" },
      });
    });
  } catch (e) {
    if (isOverlapViolation(e)) return { ok: false, issues: [OVERLAP_ISSUE], needsConfirm: false };
    throw e;
  }
  return { ok: true, shiftId: existing.id, category: existing.category, startsAt: existing.startsAt };
}

/**
 * Publicerar alla utkast (ej inställda pass) i ett månadsschema för en arbetskategori. Personalen ser bara
 * publicerade pass. Inget publiceras automatiskt. Notiser till personalen byggs senare (ännu inte aktivt).
 */
export async function publishShifts(
  db: PrismaClient,
  actor: Actor,
  input: { category: WorkCategory; year: number; month: number; now?: Date },
): Promise<{ published: number }> {
  assertCan(actor, "schedule:publish");
  const now = input.now ?? new Date();
  const schedule = await db.schedule.findUnique({
    where: { category_year_month: { category: input.category, year: input.year, month: input.month } },
  });
  if (!schedule) return { published: 0 };

  return db.$transaction(async (tx) => {
    const drafts = await tx.shift.findMany({
      where: { scheduleId: schedule.id, publicationStatus: "DRAFT", workStatus: { not: "CANCELLED" } },
      select: { assignedEmployee: { select: { userId: true } } },
    });
    const { count } = await tx.shift.updateMany({
      where: { scheduleId: schedule.id, publicationStatus: "DRAFT", workStatus: { not: "CANCELLED" } },
      data: { publicationStatus: "PUBLISHED", version: { increment: 1 } },
    });
    if (count === 0) return { published: 0 };
    const perUser = new Map<string, number>();
    for (const d of drafts) if (d.assignedEmployee.userId) perUser.set(d.assignedEmployee.userId, (perUser.get(d.assignedEmployee.userId) ?? 0) + 1);
    for (const [userId, n] of perUser) {
      await notify(tx, {
        userIds: [userId],
        type: "SCHEDULE_PUBLISHED",
        title: `Nytt schema: ${n} ${n === 1 ? "arbetspass" : "arbetspass"} publicerade`,
        body: `${input.year}-${String(input.month).padStart(2, "0")}. Se ditt schema och godkänn passen.`,
        linkPath: input.category === "BOLLPLOCKARE" ? "/bollplockare/schema" : "/golfshop/schema",
        entityType: "Schedule",
        entityId: schedule.id,
      });
    }
    await tx.schedule.update({ where: { id: schedule.id }, data: { status: "PUBLISHED", publishedAt: now } });
    await tx.schedulePublication.create({
      data: { scheduleId: schedule.id, publishedById: actor.id, shiftCount: count, employeesNotified: perUser.size },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "SCHEDULE_PUBLISHED",
      entityType: "Schedule",
      entityId: schedule.id,
      after: { category: input.category, year: input.year, month: input.month, shiftCount: count },
    });
    return { published: count };
  });
}
