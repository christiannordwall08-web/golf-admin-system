import { z } from "zod";
import { can } from "@/domain/roles";
import { dateStringToDbDate, dbDateToString, formatDateLong, formatTime, localToInstant, stockholmDateOf } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { notify } from "@/server/services/notifications";
import type { Actor } from "@/server/services/pay-rates";
import { type Ring, parseRings } from "../domain/geo";
import { type RangeDay, type RangeSettingsLike, openEndedWindow, rangeDay } from "../domain/range-time";

/**
 * Inställningar för driving range och GPS, arbetsområdet (geofence) och avvikande stängningstider.
 * Läsning kräver bara inloggning (bollplockare behöver stängningstiderna), ändring kräver `range:configure` (Admin).
 */
export type BollplockareSettingsData = {
  defaultCloseTime: string;
  checkInMarginMinutes: number;
  verificationSeconds: number;
  maxAccuracyMeters: number;
  staleAfterSeconds: number;
  returnHysteresisMeters: number;
  gpsRetentionDays: number;
  clockOutReminderMinutes: number;
  noShowAfterMinutes: number;
};

const timeStr = z.string().regex(/^(0[6-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Ange en tid mellan 06.00 och 23.59.");
const int = (min: number, max: number, label: string) =>
  z.coerce.number().int(`${label} ska vara ett heltal.`).min(min, `${label}: lägst ${min}.`).max(max, `${label}: högst ${max}.`);

export const settingsSchema = z.object({
  defaultCloseTime: timeStr,
  checkInMarginMinutes: int(0, 180, "Incheckningsmarginal"),
  verificationSeconds: int(5, 600, "Verifieringstid"),
  maxAccuracyMeters: int(5, 500, "Högsta GPS-osäkerhet"),
  staleAfterSeconds: int(30, 3600, "Gammal position efter"),
  returnHysteresisMeters: int(0, 100, "Återupptagningsmarginal"),
  gpsRetentionDays: int(1, 365, "Lagringstid för positioner"),
  clockOutReminderMinutes: int(30, 1440, "Påminnelse om utcheckning"),
  noShowAfterMinutes: int(5, 480, "Utebliven incheckning efter"),
});

export const DEFAULT_SETTINGS: BollplockareSettingsData = {
  defaultCloseTime: "20:00",
  checkInMarginMinutes: 20,
  verificationSeconds: 30,
  maxAccuracyMeters: 50,
  staleAfterSeconds: 120,
  returnHysteresisMeters: 10,
  gpsRetentionDays: 30,
  clockOutReminderMinutes: 240,
  noShowAfterMinutes: 30,
};

const settingsFields = (r: BollplockareSettingsData): BollplockareSettingsData => ({
  defaultCloseTime: r.defaultCloseTime,
  checkInMarginMinutes: r.checkInMarginMinutes,
  verificationSeconds: r.verificationSeconds,
  maxAccuracyMeters: r.maxAccuracyMeters,
  staleAfterSeconds: r.staleAfterSeconds,
  returnHysteresisMeters: r.returnHysteresisMeters,
  gpsRetentionDays: r.gpsRetentionDays,
  clockOutReminderMinutes: r.clockOutReminderMinutes,
  noShowAfterMinutes: r.noShowAfterMinutes,
});

/** Inställningarna (standardvärden om ingen rad finns). Raden skapas först när Admin sparar. */
export async function getSettings(db: DbClient): Promise<BollplockareSettingsData> {
  const row = await db.bollplockareSettings.findUnique({ where: { id: "default" } });
  return row ? settingsFields(row) : { ...DEFAULT_SETTINGS };
}

export async function updateSettings(db: PrismaClient, actor: Actor, raw: unknown, now = new Date()): Promise<BollplockareSettingsData> {
  if (!can(actor.role, "range:configure")) throw new ForbiddenError("Endast Admin får ändra inställningar.");
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga inställningar.");
  const data = parsed.data;
  const before = await getSettings(db);
  await db.$transaction(async (tx) => {
    await tx.bollplockareSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data, updatedById: actor.id }, update: { ...data, updatedById: actor.id } });
    await writeAudit(tx, { actorId: actor.id, action: "BOLLPLOCKARE_SETTINGS_CHANGED", entityType: "BollplockareSettings", entityId: "default", before, after: data });
  });
  // Ändrad stängningstid eller marginal flyttar tidigaste incheckning för alla kommande pass.
  if (before.defaultCloseTime !== data.defaultCloseTime || before.checkInMarginMinutes !== data.checkInMarginMinutes) {
    await resyncOpenEndedShifts(db, actor, now);
  }
  return data;
}

// -------------------------------------------------------------------------------------------------------------------
// Arbetsområde (geofence)
// -------------------------------------------------------------------------------------------------------------------

export type WorkAreaData = { rings: Ring[]; marginMeters: number; version: number; configured: boolean; name: string };

export async function getWorkArea(db: DbClient): Promise<WorkAreaData> {
  const row = await db.gpsWorkArea.findUnique({ where: { id: "default" } });
  if (!row) return { rings: [], marginMeters: 40, version: 0, configured: false, name: "Golfanläggningen" };
  const parsed = parseRings(row.polygons);
  return { rings: parsed.ok ? parsed.rings : [], marginMeters: row.marginMeters, version: row.version, configured: parsed.ok, name: row.name };
}

/** Sparar arbetsområdet. `expectedVersion` skyddar mot att två administratörer skriver över varandra. */
export async function saveWorkArea(
  db: PrismaClient,
  actor: Actor,
  input: { polygons: unknown; marginMeters: number; expectedVersion: number },
): Promise<WorkAreaData> {
  if (!can(actor.role, "range:configure")) throw new ForbiddenError("Endast Admin får ändra arbetsområdet.");
  const parsed = parseRings(input.polygons);
  if (!parsed.ok) throw new ValidationError(parsed.message);
  if (!Number.isInteger(input.marginMeters) || input.marginMeters < 0 || input.marginMeters > 500) {
    throw new ValidationError("Säkerhetsmarginalen ska vara 0–500 meter.");
  }
  const current = await db.gpsWorkArea.findUnique({ where: { id: "default" } });
  if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictError("Arbetsområdet ändrades av någon annan. Ladda om sidan.");
  const polygons = parsed.rings.map((r) => r.map((p) => [p[0], p[1]]));
  await db.$transaction(async (tx) => {
    if (current) {
      const { count } = await tx.gpsWorkArea.updateMany({
        where: { id: "default", version: input.expectedVersion },
        data: { polygons, marginMeters: input.marginMeters, version: { increment: 1 }, updatedById: actor.id },
      });
      if (count === 0) throw new ConflictError("Arbetsområdet ändrades av någon annan. Ladda om sidan.");
    } else {
      await tx.gpsWorkArea.create({ data: { id: "default", polygons, marginMeters: input.marginMeters, updatedById: actor.id } });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "GPS_WORK_AREA_CHANGED",
      entityType: "GpsWorkArea",
      entityId: "default",
      before: current ? { rings: Array.isArray(current.polygons) ? (current.polygons as unknown[]).length : 0, marginMeters: current.marginMeters } : undefined,
      after: { rings: polygons.length, points: polygons.reduce((n, r) => n + r.length, 0), marginMeters: input.marginMeters },
    });
  });
  return getWorkArea(db);
}

// -------------------------------------------------------------------------------------------------------------------
// Avvikande stängningstider och stängda dagar
// -------------------------------------------------------------------------------------------------------------------

export type DayOverrideData = { date: string; closeTime: string | null; isClosed: boolean; note: string | null };

export async function listOverrides(db: DbClient, fromDate: string, toDate: string): Promise<DayOverrideData[]> {
  const rows = await db.bollplockareDayOverride.findMany({
    where: { date: { gte: dateStringToDbDate(fromDate), lte: dateStringToDbDate(toDate) } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ date: dbDateToString(r.date), closeTime: r.closeTime, isClosed: r.isClosed, note: r.note }));
}

/** Rangens dag (stängningstid, tidigaste incheckning) för ett datum, med avvikelser och inställningar. */
export async function getRangeDay(db: DbClient, date: string, settings?: RangeSettingsLike): Promise<RangeDay> {
  const [s, o] = await Promise.all([settings ?? getSettings(db), db.bollplockareDayOverride.findUnique({ where: { date: dateStringToDbDate(date) } })]);
  return rangeDay(date, s, o);
}

const overrideSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum."),
  closed: z.boolean(),
  closeTime: timeStr.nullable().optional(),
  note: z.string().trim().max(200, "Noteringen får vara högst 200 tecken.").nullable().optional(),
});

export async function setDayOverride(db: PrismaClient, actor: Actor, raw: unknown, now = new Date()): Promise<void> {
  if (!can(actor.role, "range:configure")) throw new ForbiddenError("Endast Admin får ändra stängningstider.");
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltig dag.");
  const { date, closed, note } = parsed.data;
  if (!closed && !parsed.data.closeTime) throw new ValidationError("Ange en stängningstid, eller markera dagen som stängd.");
  if (Number.isNaN(localToInstant(date, "12:00").getTime())) throw new ValidationError("Ogiltigt datum.");
  const data = { closeTime: closed ? null : (parsed.data.closeTime ?? null), isClosed: closed, note: note?.trim() || null };
  const dbDate = dateStringToDbDate(date);
  await db.$transaction(async (tx) => {
    const before = await tx.bollplockareDayOverride.findUnique({ where: { date: dbDate } });
    await tx.bollplockareDayOverride.upsert({ where: { date: dbDate }, create: { date: dbDate, ...data, createdById: actor.id }, update: data });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "BOLLPLOCKARE_DAY_OVERRIDE_SET",
      entityType: "BollplockareDayOverride",
      entityId: date,
      before: before ? { closeTime: before.closeTime, isClosed: before.isClosed } : undefined,
      after: data,
    });
  });
  await resyncOpenEndedShifts(db, actor, now);
}

export async function removeDayOverride(db: PrismaClient, actor: Actor, date: string, now = new Date()): Promise<void> {
  if (!can(actor.role, "range:configure")) throw new ForbiddenError("Endast Admin får ändra stängningstider.");
  const dbDate = dateStringToDbDate(date);
  await db.$transaction(async (tx) => {
    const before = await tx.bollplockareDayOverride.findUnique({ where: { date: dbDate } });
    if (!before) return;
    await tx.bollplockareDayOverride.delete({ where: { date: dbDate } });
    await writeAudit(tx, { actorId: actor.id, action: "BOLLPLOCKARE_DAY_OVERRIDE_REMOVED", entityType: "BollplockareDayOverride", entityId: date, before: { closeTime: before.closeTime, isClosed: before.isClosed } });
  });
  await resyncOpenEndedShifts(db, actor, now);
}

// -------------------------------------------------------------------------------------------------------------------
// Synkning av pass utan fast sluttid
// -------------------------------------------------------------------------------------------------------------------

/**
 * Räknar om tidigaste incheckning för alla kommande, oinställda pass utan fast sluttid som saknar tidsregistrering,
 * efter ändrad stängningstid, marginal eller avvikande dag. Berörda bollplockare får en notis om tiden ändrats.
 * Pass på en stängd dag lämnas orörda (Admin avgör: ställ in passet). Returnerar antal ändrade pass.
 */
export async function resyncOpenEndedShifts(db: PrismaClient, actor: Actor | null, now = new Date()): Promise<number> {
  const settings = await getSettings(db);
  const today = stockholmDateOf(now);
  const shifts = await db.shift.findMany({
    where: { openEnded: true, workStatus: { not: "CANCELLED" }, localDate: { gte: dateStringToDbDate(today) }, workTimeEntry: null },
    select: { id: true, localDate: true, startsAt: true, endsAt: true, publicationStatus: true, assignedEmployee: { select: { userId: true } } },
  });
  if (shifts.length === 0) return 0;
  const dates = [...new Set(shifts.map((s) => dbDateToString(s.localDate)))];
  const overrides = await db.bollplockareDayOverride.findMany({ where: { date: { in: dates.map(dateStringToDbDate) } } });
  const byDate = new Map(overrides.map((o) => [dbDateToString(o.date), o]));

  let changed = 0;
  for (const s of shifts) {
    const date = dbDateToString(s.localDate);
    const window = openEndedWindow(rangeDay(date, settings, byDate.get(date)));
    if (!window) continue;
    if (window.startsAt.getTime() === s.startsAt.getTime() && window.endsAt.getTime() === s.endsAt.getTime()) continue;
    await db.$transaction(async (tx) => {
      await tx.shift.update({ where: { id: s.id }, data: { startsAt: window.startsAt, endsAt: window.endsAt, version: { increment: 1 } } });
      if (s.publicationStatus === "PUBLISHED" && s.assignedEmployee.userId) {
        const earliest = window.startsAt;
        await notify(tx, {
          userIds: [s.assignedEmployee.userId],
          type: "SHIFT_CHANGED",
          title: `Ändrad incheckningstid ${formatDateLong(localToInstant(date, "12:00"))}`,
          body: `Rangen stänger ${(byDate.get(date)?.closeTime ?? settings.defaultCloseTime).replace(":", ".")}. Du kan klocka in från ${formatTime(earliest)}.`,
          linkPath: "/bollplockare/schema",
          entityType: "Shift",
          entityId: s.id,
        });
      }
    });
    changed++;
  }
  if (changed > 0) {
    await writeAudit(db, { actorId: actor?.id ?? null, action: "BOLLPLOCKARE_SHIFTS_RESYNCED", entityType: "Shift", metadata: { changed } });
  }
  return changed;
}
