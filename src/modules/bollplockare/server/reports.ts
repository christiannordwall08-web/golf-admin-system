import { type WorkCategory, can } from "@/domain/roles";
import { compensationOre } from "@/domain/money";
import { type RatePeriod, resolveRateForDate } from "@/domain/pay-rates";
import { dateStringToDbDate, dbDateToString, formatTime } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { fullName, toRatePeriods } from "@/server/queries/mappers";
import { notify } from "@/server/services/notifications";
import type { Actor } from "@/server/services/pay-rates";
import { hoursFromMinutes, toCsv } from "../domain/csv";
import { rangeDay } from "../domain/range-time";
import { pausedSecondsBetween } from "../domain/worktime";
import { getSettings } from "./settings";

/**
 * Arbetstidshistorik, granskning, godkännande och korrigering av registrerad tid (Admin) samt bollplockarens egna rapport.
 *  - Bara godkänd tid (approvedMinutes) ger ersättning. Registrerad tid är preliminär tills Admin godkänt eller korrigerat den.
 *  - Varje korrigering sparas append-only med ursprungsvärde, nytt värde, anledning, vem och när (WorkTimeCorrection).
 *  - En låst månadsrapport kan inte ändras här.
 */
export type WorkEntryStatus = "PRELIMINARY" | "APPROVED" | "CORRECTED" | "ABSENT" | "VOID";

export type WorkEntryRow = {
  entryId: string;
  employeeId: string;
  employeeName: string;
  category: WorkCategory;
  workDate: string;
  /** Rangens stängningstid den dagen (bollplockare), annars null. */
  closeTime: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  totalMinutes: number | null;
  pausedMinutes: number;
  pauseCount: number;
  registeredMinutes: number;
  approvedMinutes: number | null;
  status: WorkEntryStatus;
  needsReview: boolean;
  reviewReasons: string[];
  corrected: boolean;
  open: boolean;
  hourlyRateOre: number | null;
  /** Ersättning på godkänd tid (om timlön finns). Null för ej godkänd tid. */
  compensationOre: number | null;
};

export type WorkEntryFilter = {
  from: string;
  to: string;
  employeeId?: string;
  status?: "ALL" | "NEEDS_REVIEW" | "APPROVED" | "PRELIMINARY";
  category?: WorkCategory | null;
};

const entryInclude = {
  employee: { select: { firstName: true, lastName: true, hourlyPaid: true, payRates: true } },
  bollplockareSession: { select: { pausedMinutes: true, needsReview: true, reviewReasons: true, pauses: { select: { id: true, voidedAt: true } } } },
  corrections: { select: { id: true } },
} as const;

type EntryRecord = Awaited<ReturnType<typeof loadEntries>>[number];

async function loadEntries(db: DbClient, filter: WorkEntryFilter) {
  const status =
    filter.status === "APPROVED"
      ? { status: { in: ["APPROVED", "CORRECTED"] as ("APPROVED" | "CORRECTED")[] } }
      : filter.status === "PRELIMINARY"
        ? { status: "PRELIMINARY" as const }
        : filter.status === "NEEDS_REVIEW"
          ? { status: "PRELIMINARY" as const, registeredEndsAt: { not: null }, bollplockareSession: { needsReview: true } }
          : {};
  return db.workTimeEntry.findMany({
    where: {
      source: "GPS",
      workDate: { gte: dateStringToDbDate(filter.from), lte: dateStringToDbDate(filter.to) },
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...status,
    },
    include: entryInclude,
    orderBy: [{ workDate: "desc" }, { registeredStartsAt: "desc" }],
  });
}

async function toRows(db: DbClient, entries: EntryRecord[]): Promise<WorkEntryRow[]> {
  const settings = await getSettings(db);
  const dates = [...new Set(entries.map((e) => dbDateToString(e.workDate)))];
  const overrides = dates.length ? await db.bollplockareDayOverride.findMany({ where: { date: { in: dates.map(dateStringToDbDate) } } }) : [];
  const byDate = new Map(overrides.map((o) => [dbDateToString(o.date), o]));
  return entries.map((e) => {
    const date = dbDateToString(e.workDate);
    const s = e.bollplockareSession;
    const rate: RatePeriod | null = e.employee.hourlyPaid ? resolveRateForDate(toRatePeriods(e.employee.payRates), date) : null;
    const approved = e.status === "APPROVED" || e.status === "CORRECTED";
    return {
      entryId: e.id,
      employeeId: e.employeeId,
      employeeName: fullName(e.employee),
      category: e.category,
      workDate: date,
      closeTime: e.category === "BOLLPLOCKARE" ? (rangeDay(date, settings, byDate.get(date)).closeTime ?? "Stängt") : null,
      startedAt: e.registeredStartsAt,
      endedAt: e.registeredEndsAt,
      totalMinutes: e.registeredStartsAt && e.registeredEndsAt ? Math.round((e.registeredEndsAt.getTime() - e.registeredStartsAt.getTime()) / 60_000) : null,
      pausedMinutes: s?.pausedMinutes ?? 0,
      pauseCount: s?.pauses.filter((p) => !p.voidedAt).length ?? 0,
      registeredMinutes: e.registeredMinutes,
      approvedMinutes: e.approvedMinutes,
      status: e.status,
      needsReview: Boolean(s?.needsReview) && !approved,
      reviewReasons: s?.reviewReasons ?? [],
      corrected: e.corrections.length > 0,
      open: e.registeredEndsAt === null,
      hourlyRateOre: rate?.hourlyRateOre ?? null,
      compensationOre: approved && rate && e.approvedMinutes !== null ? compensationOre(e.approvedMinutes, rate.hourlyRateOre) : null,
    };
  });
}

export async function listWorkEntries(db: DbClient, actor: Actor, filter: WorkEntryFilter): Promise<WorkEntryRow[]> {
  if (!can(actor.role, "worktime:read:all")) throw new ForbiddenError();
  return toRows(db, await loadEntries(db, filter));
}

/** Bollplockarens egna registreringar (bara den inloggade personens egna, avgränsat med userId från sessionen). */
export async function listMyWorkEntries(db: DbClient, actor: Actor, input: { from: string; to: string }): Promise<WorkEntryRow[]> {
  if (!can(actor.role, "worktime:read:own")) throw new ForbiddenError();
  const mine = await db.employee.findMany({ where: { userId: actor.id, category: "BOLLPLOCKARE" }, select: { id: true } });
  const entries = (await loadEntries(db, { ...input, category: "BOLLPLOCKARE" })).filter((e) => mine.some((m) => m.id === e.employeeId));
  return toRows(db, entries);
}

export type MonthlySummaryRow = {
  employeeId: string;
  employeeName: string;
  sessions: number;
  registeredMinutes: number;
  approvedMinutes: number;
  pendingMinutes: number;
  needsReview: number;
  pauses: number;
  compensationOre: number;
};

export function summarizeByEmployee(rows: readonly WorkEntryRow[]): MonthlySummaryRow[] {
  const map = new Map<string, MonthlySummaryRow>();
  for (const r of rows) {
    if (r.open) continue;
    const m = map.get(r.employeeId) ?? { employeeId: r.employeeId, employeeName: r.employeeName, sessions: 0, registeredMinutes: 0, approvedMinutes: 0, pendingMinutes: 0, needsReview: 0, pauses: 0, compensationOre: 0 };
    m.sessions++;
    m.registeredMinutes += r.registeredMinutes;
    if (r.status === "APPROVED" || r.status === "CORRECTED") m.approvedMinutes += r.approvedMinutes ?? 0;
    else m.pendingMinutes += r.registeredMinutes;
    if (r.needsReview) m.needsReview++;
    m.pauses += r.pauseCount;
    m.compensationOre += r.compensationOre ?? 0;
    map.set(r.employeeId, m);
  }
  return [...map.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, "sv"));
}

export const CSV_HEADER = [
  "Anställd", "Datum", "Arbetskategori", "Rangens stängningstid", "Incheckning", "Utcheckning", "Total tid (min)", "Paus (min)",
  "Registrerad tid (min)", "Registrerad tid (tim)", "Godkänd tid (min)", "Godkänd tid (tim)", "Status", "Kräver granskning",
  "Geografiska avvikelser (antal)", "Manuellt korrigerad", "Timlön (kr)", "Ersättning (kr)",
] as const;

const STATUS_SV: Record<WorkEntryStatus, string> = { PRELIMINARY: "Preliminär", APPROVED: "Godkänd", CORRECTED: "Korrigerad och godkänd", ABSENT: "Frånvaro", VOID: "Ogiltig" };
export const statusLabel = (s: WorkEntryStatus) => STATUS_SV[s];

/** Löneunderlag som CSV: en rad per arbetspass med namn på varje rad. */
export function workEntriesToCsv(rows: readonly WorkEntryRow[]): string {
  const kr = (ore: number | null) => (ore === null ? null : (ore / 100).toFixed(2).replace(".", ","));
  return toCsv(
    CSV_HEADER,
    rows.map((r) => [
      r.employeeName, r.workDate, r.category === "BOLLPLOCKARE" ? "Bollplockare" : "Golfshop", r.closeTime,
      r.startedAt ? formatTime(r.startedAt) : "", r.endedAt ? formatTime(r.endedAt) : r.open ? "Pågår" : "",
      r.totalMinutes, r.pausedMinutes, r.registeredMinutes, hoursFromMinutes(r.registeredMinutes),
      r.approvedMinutes, hoursFromMinutes(r.approvedMinutes), statusLabel(r.status), r.needsReview, r.pauseCount, r.corrected,
      kr(r.hourlyRateOre), kr(r.compensationOre),
    ]),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Ett pass i detalj (Admin)
// ---------------------------------------------------------------------------------------------------------------------

export async function getWorkEntryDetail(db: DbClient, actor: Actor, entryId: string) {
  if (!can(actor.role, "worktime:read:all")) throw new ForbiddenError();
  const e = await db.workTimeEntry.findUnique({
    where: { id: entryId },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      shift: { select: { id: true, localDate: true } },
      approvedBy: { select: { name: true, email: true } },
      bollplockareSession: { include: { pauses: { orderBy: { startedAt: "asc" }, include: { voidedBy: { select: { name: true, email: true } } } }, events: { orderBy: { at: "asc" } } } },
      corrections: { orderBy: { createdAt: "asc" }, include: { correctedBy: { select: { name: true, email: true } } } },
    },
  });
  if (!e) throw new NotFoundError("Registreringen finns inte.");
  const [row] = await toRows(db, await loadEntries(db, { from: dbDateToString(e.workDate), to: dbDateToString(e.workDate), employeeId: e.employeeId }).then((all) => all.filter((x) => x.id === entryId)));
  return { entry: e, row };
}

// ---------------------------------------------------------------------------------------------------------------------
// Godkänn och korrigera
// ---------------------------------------------------------------------------------------------------------------------

async function assertMonthOpen(db: DbClient, workDate: Date) {
  const d = dbDateToString(workDate);
  const report = await db.monthlyPayrollReport.findUnique({ where: { year_month: { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) } } });
  if (report?.status === "LOCKED") throw new ConflictError("Månaden är låst. Ändringar görs som en justering i den låsta rapporten.");
}

export async function approveWorkEntry(db: PrismaClient, actor: Actor, entryId: string, now = new Date()): Promise<void> {
  if (!can(actor.role, "worktime:approve")) throw new ForbiddenError("Endast Admin får godkänna arbetstid.");
  const e = await db.workTimeEntry.findUnique({ where: { id: entryId }, include: { employee: { include: { payRates: true } } } });
  if (!e) throw new NotFoundError("Registreringen finns inte.");
  if (e.status === "APPROVED" || e.status === "CORRECTED") return; // redan godkänd
  if (!e.registeredEndsAt) throw new ValidationError("Passet pågår fortfarande och kan inte godkännas.");
  await assertMonthOpen(db, e.workDate);
  const rate = e.employee.hourlyPaid ? resolveRateForDate(toRatePeriods(e.employee.payRates), dbDateToString(e.workDate)) : null;
  await db.$transaction(async (tx) => {
    const { count } = await tx.workTimeEntry.updateMany({
      where: { id: e.id, version: e.version, status: "PRELIMINARY" },
      data: { status: "APPROVED", approvedMinutes: e.registeredMinutes, approvedAt: now, approvedById: actor.id, payRateId: rate?.id ?? null, version: { increment: 1 } },
    });
    if (count === 0) throw new ConflictError();
    await tx.bollplockareSession.updateMany({ where: { entryId: e.id }, data: { needsReview: false } });
    await writeAudit(tx, { actorId: actor.id, action: "WORKTIME_APPROVED", entityType: "WorkTimeEntry", entityId: e.id, after: { approvedMinutes: e.registeredMinutes } });
  });
}

export type CorrectionInput = {
  expectedVersion: number;
  reason: string;
  startedAt?: Date;
  endedAt?: Date;
  /** Anger paustiden manuellt (minuter). Utelämnad = räknas från pauserna. */
  pausedMinutes?: number | null;
  /** Pauser som ogiltigförklaras (de räknas inte längre, men finns kvar i historiken). */
  voidPauseIds?: string[];
  now?: Date;
};

export async function correctWorkEntry(db: PrismaClient, actor: Actor, entryId: string, input: CorrectionInput) {
  if (!can(actor.role, "worktime:correct")) throw new ForbiddenError("Endast Admin får korrigera arbetstid.");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new ValidationError("Ange en anledning till korrigeringen (minst 5 tecken).");
  if (reason.length > 500) throw new ValidationError("Anledningen får vara högst 500 tecken.");
  const now = input.now ?? new Date();

  const e = await db.workTimeEntry.findUnique({
    where: { id: entryId },
    include: { employee: { include: { payRates: true } }, bollplockareSession: { include: { pauses: true } } },
  });
  if (!e) throw new NotFoundError("Registreringen finns inte.");
  if (!e.registeredStartsAt || !e.registeredEndsAt) throw new ValidationError("Passet pågår fortfarande. Det går att korrigera när det är avslutat.");
  if (e.version !== input.expectedVersion) throw new ConflictError();
  await assertMonthOpen(db, e.workDate);

  const prevStart = e.registeredStartsAt;
  const prevEnd = e.registeredEndsAt;
  const startedAt = input.startedAt ?? prevStart;
  const endedAt = input.endedAt ?? prevEnd;
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) throw new ValidationError("Ogiltig tid.");
  if (endedAt <= startedAt) throw new ValidationError("Utcheckningen måste vara efter incheckningen.");
  if (endedAt > now) throw new ValidationError("Utcheckningen kan inte ligga i framtiden.");
  if (endedAt.getTime() - startedAt.getTime() > 24 * 3_600_000) throw new ValidationError("Ett pass får vara högst 24 timmar.");

  const session = e.bollplockareSession;
  const void_ = new Set(input.voidPauseIds ?? []);
  if (session) for (const id of void_) if (!session.pauses.some((p) => p.id === id)) throw new ValidationError("Okänd paus.");
  const pauses = (session?.pauses ?? []).map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt, voided: p.voidedAt !== null || void_.has(p.id) }));
  const totalSeconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
  let pausedSeconds = pausedSecondsBetween(pauses, startedAt, endedAt);
  if (input.pausedMinutes !== undefined && input.pausedMinutes !== null) {
    if (!Number.isInteger(input.pausedMinutes) || input.pausedMinutes < 0) throw new ValidationError("Paustiden ska vara ett heltal (minuter).");
    pausedSeconds = input.pausedMinutes * 60;
  }
  if (pausedSeconds > totalSeconds) throw new ValidationError("Paustiden kan inte vara längre än hela passet.");
  const registeredMinutes = Math.round((totalSeconds - pausedSeconds) / 60);
  const pausedMinutes = Math.round(pausedSeconds / 60);
  const rate = e.employee.hourlyPaid ? resolveRateForDate(toRatePeriods(e.employee.payRates), dbDateToString(e.workDate)) : null;

  const detail = {
    startedAt: [prevStart.toISOString(), startedAt.toISOString()],
    endedAt: [prevEnd.toISOString(), endedAt.toISOString()],
    pausedMinutes: [session?.pausedMinutes ?? 0, pausedMinutes],
    registeredMinutes: [e.registeredMinutes, registeredMinutes],
    voidedPauses: [...void_],
  };
  await db.$transaction(async (tx) => {
    const { count } = await tx.workTimeEntry.updateMany({
      where: { id: e.id, version: e.version },
      data: {
        registeredStartsAt: startedAt,
        registeredEndsAt: endedAt,
        registeredMinutes,
        approvedMinutes: registeredMinutes,
        status: "CORRECTED",
        approvedAt: now,
        approvedById: actor.id,
        payRateId: rate?.id ?? null,
        version: { increment: 1 },
      },
    });
    if (count === 0) throw new ConflictError();
    if (session) {
      for (const id of void_) await tx.gpsPause.update({ where: { id }, data: { voidedAt: now, voidedById: actor.id, voidReason: reason } });
      await tx.bollplockareSession.update({ where: { id: session.id }, data: { pausedMinutes, needsReview: false } });
      await tx.gpsEvent.create({ data: { sessionId: session.id, type: void_.size ? "PAUSE_VOIDED" : "ADMIN_CORRECTION", at: now, actorId: actor.id, data: { reason, voidedPauses: [...void_] } } });
    }
    await tx.workTimeCorrection.create({
      data: {
        workTimeEntryId: e.id,
        previousApprovedMinutes: e.approvedMinutes,
        newApprovedMinutes: registeredMinutes,
        previousStatus: e.status,
        newStatus: "CORRECTED",
        reason,
        detail,
        correctedById: actor.id,
      },
    });
    await writeAudit(tx, { actorId: actor.id, action: "WORKTIME_CORRECTED", entityType: "WorkTimeEntry", entityId: e.id, before: { registeredMinutes: e.registeredMinutes }, after: { registeredMinutes }, metadata: { reason } });
    if (e.employee.userId) {
      await notify(tx, {
        userIds: [e.employee.userId],
        type: "WORKTIME_CORRECTED",
        title: `Din arbetstid ${dbDateToString(e.workDate)} har korrigerats`,
        body: `${formatTime(prevStart)}–${formatTime(prevEnd)} (${e.registeredMinutes} min) → ${formatTime(startedAt)}–${formatTime(endedAt)} (${registeredMinutes} min). Anledning: ${reason}`,
        linkPath: "/bollplockare/timmar",
        entityType: "WorkTimeEntry",
        entityId: e.id,
      });
    }
  });
  return { registeredMinutes, pausedMinutes };
}
