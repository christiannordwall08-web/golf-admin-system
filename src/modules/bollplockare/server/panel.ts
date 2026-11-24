import { addDaysToDateString, dateStringToDbDate, dbDateToString, stockholmDateOf } from "@/domain/time";
import type { DbClient } from "@/server/db-client";
import type { Actor } from "@/server/services/pay-rates";
import type { DisplayGpsStatus } from "../domain/tracking";
import { displayGpsStatus } from "../domain/tracking";
import { type ActiveSnapshot, type MyClockState, getMyClockState } from "./clock";
import { getRangeDay, getSettings } from "./settings";

/** JSON-vänlig form av bollplockarens läge (Date → ISO-sträng), som skickas till panelens klientdel. */
export type PanelSnapshot = {
  entryId: string;
  serverNow: string;
  startedAt: string;
  workedSeconds: number;
  pausedSeconds: number;
  pauseOpenSince: string | null;
  pauseCount: number;
  gps: DisplayGpsStatus;
  lastPositionAt: string | null;
  lastDistanceM: number | null;
};

export type PanelState = {
  serverNow: string;
  firstName: string;
  settings: MyClockState["settings"];
  areaConfigured: boolean;
  shift: null | {
    id: string;
    date: string;
    approvalStatus: "PENDING" | "APPROVED" | "CHANGE_REQUESTED" | "APPROVED_AFTER_SWAP";
    closeTime: string | null;
    closed: boolean;
    earliestCheckIn: string | null;
    windowEnd: string;
  };
  availability: { status: string; secondsUntil?: number; opensAt?: string };
  active: PanelSnapshot | null;
  finished: null | { startedAt: string; endedAt: string; totalMinutes: number; pausedMinutes: number; registeredMinutes: number; status: string };
  next: null | { shiftId: string; date: string; closeTime: string | null; earliestCheckIn: string | null; approvalStatus: string };
};

export function toSnapshot(a: ActiveSnapshot, staleAfterSeconds: number): PanelSnapshot {
  return {
    entryId: a.entryId,
    serverNow: a.serverNow.toISOString(),
    startedAt: a.startedAt.toISOString(),
    workedSeconds: a.workedSeconds,
    pausedSeconds: a.pausedSeconds,
    pauseOpenSince: a.pauseOpenSince?.toISOString() ?? null,
    pauseCount: a.pauseCount,
    gps: displayGpsStatus(a.gpsStatus, a.lastPositionAt, a.lastContactAt, a.serverNow, staleAfterSeconds),
    lastPositionAt: a.lastPositionAt?.toISOString() ?? null,
    lastDistanceM: a.lastDistanceM,
  };
}

/** Allt som behövs för att rita panelen. Hämtas på servern vid varje sidladdning (ingen timer är källa till sanning). */
export async function getPanelState(db: DbClient, actor: Actor, now = new Date()): Promise<PanelState> {
  const s = await getMyClockState(db, actor, now);
  const settings = await getSettings(db);
  const today = stockholmDateOf(now);

  // Nästa kommande pass (efter dagens), för kortet när det inte finns något pass idag.
  const upcoming = await db.shift.findFirst({
    where: {
      assignedEmployeeId: s.employee.id,
      openEnded: true,
      publicationStatus: "PUBLISHED",
      workStatus: { not: "CANCELLED" },
      localDate: { gt: dateStringToDbDate(today) },
    },
    orderBy: { localDate: "asc" },
  });
  const nextDay = upcoming ? await getRangeDay(db, dbDateToString(upcoming.localDate), settings) : null;
  void addDaysToDateString;

  return {
    serverNow: now.toISOString(),
    firstName: s.employee.firstName,
    settings: s.settings,
    areaConfigured: s.areaConfigured,
    shift: s.shift && {
      id: s.shift.id,
      date: s.shift.date,
      approvalStatus: s.shift.approvalStatus,
      closeTime: s.shift.day.closeTime,
      closed: s.shift.day.closed,
      earliestCheckIn: s.shift.day.earliestCheckIn?.toISOString() ?? null,
      windowEnd: s.shift.day.windowEnd.toISOString(),
    },
    availability: {
      status: s.availability.status,
      secondsUntil: s.availability.status === "TOO_EARLY" ? s.availability.secondsUntil : undefined,
      opensAt: s.availability.status === "TOO_EARLY" ? s.availability.opensAt.toISOString() : undefined,
    },
    active: s.active && toSnapshot(s.active, settings.staleAfterSeconds),
    finished: s.finished && {
      startedAt: s.finished.startedAt.toISOString(),
      endedAt: s.finished.endedAt.toISOString(),
      totalMinutes: s.finished.totalMinutes,
      pausedMinutes: s.finished.pausedMinutes,
      registeredMinutes: s.finished.registeredMinutes,
      status: s.finished.status,
    },
    next: upcoming && nextDay
      ? { shiftId: upcoming.id, date: dbDateToString(upcoming.localDate), closeTime: nextDay.closeTime, earliestCheckIn: nextDay.earliestCheckIn?.toISOString() ?? null, approvalStatus: upcoming.approvalStatus }
      : null,
  };
}
