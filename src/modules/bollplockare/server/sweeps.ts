import { addDaysToDateString, dateStringToDbDate, dbDateToString, formatTime, stockholmDateOf } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import type { PrismaClient } from "@/server/db-client";
import { fullName } from "@/server/queries/mappers";
import { adminUserIds, notify } from "@/server/services/notifications";
import { getRangeDay, getSettings } from "./settings";

/**
 * Periodiska kontroller. Allt här är IDEMPOTENT (samma händelse ger aldrig dubbla notiser) och ändrar ALDRIG en arbetstid:
 * en bollplockare som glömt klocka ut får en påminnelse och admin uppmärksammas, men passet avslutas inte automatiskt.
 *
 * Körs (a) av en schemalagd anropare mot /api/internal/sweeps (se docs/BOLLPLOCKARE-GPS.md) och (b) lojalt när admin eller
 * bollplockare öppnar sin panel (`maybeRunSweeps`), så att det fungerar även utan cron.
 */
export type SweepResult = { clockOutReminders: number; noShows: number; shiftReminders: number; gpsAlerts: number; purgedPositions: number };

/** Hur länge en pågående bollplockare får sakna verifierad position innan admin uppmärksammas (minuter). */
export const GPS_UNVERIFIED_ALERT_MINUTES = 10;
const GPS_ALERT_REPEAT_MINUTES = 60;
/** Påminnelse om kommande pass skickas så här många minuter före tidigaste incheckning. */
export const SHIFT_REMINDER_LEAD_MINUTES = 120;

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

export async function runBollplockareSweeps(db: PrismaClient, now = new Date()): Promise<SweepResult> {
  const settings = await getSettings(db);
  const admins = await adminUserIds(db);
  const result: SweepResult = { clockOutReminders: 0, noShows: 0, shiftReminders: 0, gpsAlerts: 0, purgedPositions: 0 };

  // 1. Glömd utcheckning: en påminnelse per pass, aldrig en ändrad tid.
  const open = await db.bollplockareSession.findMany({
    where: { entry: { registeredEndsAt: null, registeredStartsAt: { lte: minutesAgo(now, settings.clockOutReminderMinutes) } }, clockOutReminderSentAt: null },
    include: { entry: { include: { employee: { select: { firstName: true, lastName: true, userId: true } } } } },
  });
  for (const s of open) {
    const hours = Math.floor((now.getTime() - s.entry.registeredStartsAt!.getTime()) / 3_600_000);
    const done = await db.$transaction(async (tx) => {
      const { count } = await tx.bollplockareSession.updateMany({ where: { id: s.id, clockOutReminderSentAt: null }, data: { clockOutReminderSentAt: now } });
      if (count === 0) return false;
      await tx.gpsEvent.create({ data: { sessionId: s.id, type: "CLOCK_OUT_REMINDER", at: now } });
      if (s.entry.employee.userId) {
        await notify(tx, {
          userIds: [s.entry.employee.userId],
          type: "CLOCK_OUT_REMINDER",
          title: "Glömt klocka ut?",
          body: `Du har varit incheckad sedan ${formatTime(s.entry.registeredStartsAt!)}. Är du klar? Klocka ut i appen.`,
          linkPath: "/bollplockare",
          entityType: "WorkTimeEntry",
          entityId: s.entryId,
        });
      }
      await notify(tx, {
        userIds: admins,
        type: "CLOCK_OUT_REMINDER",
        title: `${fullName(s.entry.employee)} har inte klockat ut`,
        body: `Incheckad ${formatTime(s.entry.registeredStartsAt!)} (${hours} h sedan). Arbetstiden avslutas inte automatiskt.`,
        linkPath: `/admin/bollplockare/pass/${s.entryId}`,
        entityType: "WorkTimeEntry",
        entityId: s.entryId,
      });
      return true;
    });
    if (done) result.clockOutReminders++;
  }

  // 2. GPS-position som inte kunnat verifieras på länge (ingen avvikelse, bara en uppmärksammad lucka).
  const stale = await db.bollplockareSession.findMany({
    where: { entry: { registeredEndsAt: null } },
    include: { entry: { include: { employee: { select: { firstName: true, lastName: true } } } } },
  });
  for (const s of stale) {
    const last = s.lastPositionAt ?? s.entry.registeredStartsAt!;
    if (last > minutesAgo(now, GPS_UNVERIFIED_ALERT_MINUTES)) continue;
    const recent = await db.notification.findFirst({
      where: { type: "GPS_UNVERIFIED", entityId: s.entryId, createdAt: { gt: minutesAgo(now, GPS_ALERT_REPEAT_MINUTES) } },
      select: { id: true },
    });
    if (recent) continue;
    await notify(db, {
      userIds: admins,
      type: "GPS_UNVERIFIED",
      title: `GPS-positionen för ${fullName(s.entry.employee)} kan inte verifieras`,
      body: `Senast verifierad position: ${formatTime(last)}. Arbetstiden räknas som vanligt tills positionen är tillbaka.`,
      linkPath: `/admin/bollplockare/pass/${s.entryId}`,
      entityType: "WorkTimeEntry",
      entityId: s.entryId,
    });
    result.gpsAlerts++;
  }

  // 3. Uteblivna incheckningar och påminnelser om kommande pass.
  const today = stockholmDateOf(now);
  const dates = [addDaysToDateString(today, -1), today];
  const shifts = await db.shift.findMany({
    where: { openEnded: true, publicationStatus: "PUBLISHED", workStatus: { not: "CANCELLED" }, localDate: { in: dates.map(dateStringToDbDate) }, workTimeEntry: null },
    include: { assignedEmployee: { select: { firstName: true, lastName: true, userId: true } } },
  });
  for (const shift of shifts) {
    const day = await getRangeDay(db, dbDateToString(shift.localDate), settings);
    if (day.closed || !day.closeAt || !day.earliestCheckIn) continue;
    const name = fullName(shift.assignedEmployee);
    if (now >= new Date(day.closeAt.getTime() + settings.noShowAfterMinutes * 60_000) && now < day.windowEnd) {
      if (!(await db.notification.findFirst({ where: { type: "NO_SHOW", entityId: shift.id }, select: { id: true } }))) {
        await notify(db, {
          userIds: admins,
          type: "NO_SHOW",
          title: `${name} har inte klockat in`,
          body: `Rangen stängde ${day.closeTime?.replace(":", ".")}. Ingen incheckning ${settings.noShowAfterMinutes} minuter efter stängning.`,
          linkPath: "/admin/bollplockare",
          entityType: "Shift",
          entityId: shift.id,
        });
        result.noShows++;
      }
    }
    if (shift.assignedEmployee.userId && now < day.earliestCheckIn && now >= new Date(day.earliestCheckIn.getTime() - SHIFT_REMINDER_LEAD_MINUTES * 60_000)) {
      if (!(await db.notification.findFirst({ where: { type: "SHIFT_REMINDER", entityId: shift.id }, select: { id: true } }))) {
        await notify(db, {
          userIds: [shift.assignedEmployee.userId],
          type: "SHIFT_REMINDER",
          title: "Du jobbar i kväll",
          body: `Rangen stänger ${day.closeTime?.replace(":", ".")}. Du kan klocka in från ${formatTime(day.earliestCheckIn)}.`,
          linkPath: "/bollplockare",
          entityType: "Shift",
          entityId: shift.id,
        });
        result.shiftReminders++;
      }
    }
  }

  result.purgedPositions = await purgeOldPositions(db, now, settings.gpsRetentionDays);
  if (Object.values(result).some((n) => n > 0)) {
    await writeAudit(db, { actorId: null, action: "BOLLPLOCKARE_SWEEP", entityType: "BollplockareSession", metadata: result });
  }
  return result;
}

/** Rensar koordinater (inte avstånd eller tider) från gamla pauser efter lagringstiden. Returnerar antal rensade pauser. */
export async function purgeOldPositions(db: PrismaClient, now: Date, retentionDays: number): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const r = await db.gpsPause.updateMany({
    where: { createdAt: { lt: cutoff }, OR: [{ lat: { not: null } }, { lng: { not: null } }, { accuracyM: { not: null } }] },
    data: { lat: null, lng: null, accuracyM: null },
  });
  return r.count;
}

let lastSweep = 0;
/** Kör kontrollerna högst en gång per minut per processinstans. Fel får aldrig stoppa sidan som anropar. */
export async function maybeRunSweeps(db: PrismaClient, now = new Date()): Promise<void> {
  if (now.getTime() - lastSweep < 60_000) return;
  lastSweep = now.getTime();
  try {
    await runBollplockareSweeps(db, now);
  } catch (e) {
    console.error("Bollplockare-kontroller misslyckades", e);
  }
}
