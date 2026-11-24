import { can } from "@/domain/roles";
import { addDaysToDateString, dateStringToDbDate, dbDateToString, stockholmDateOf, stockholmYearMonth } from "@/domain/time";
import type { DbClient } from "@/server/db-client";
import { ForbiddenError } from "@/server/errors";
import { fullName } from "@/server/queries/mappers";
import type { Actor } from "@/server/services/pay-rates";
import { type DisplayGpsStatus, displayGpsStatus, isPositionStale } from "../domain/tracking";
import { type WorkState, deriveWorkState, liveWorkedSeconds } from "../domain/worktime";
import { summarizeByEmployee, listWorkEntries } from "./reports";
import { type BollplockareSettingsData, type WorkAreaData, getRangeDay, getSettings, getWorkArea } from "./settings";

/**
 * Admins realtidsöversikt över bollplockarna. Visar bara det som finns under ett PÅGÅENDE pass:
 * positioner finns inte efter utcheckning (de rensas), och en gammal position märks alltid som gammal.
 */
export type LivePerson = {
  employeeId: string;
  name: string;
  shiftId: string;
  date: string;
  closeTime: string | null;
  earliestCheckIn: Date | null;
  approvalStatus: "PENDING" | "APPROVED" | "CHANGE_REQUESTED" | "APPROVED_AFTER_SWAP";
  published: boolean;
  state: WorkState;
  entryId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  workedSeconds: number | null;
  pauseOpenSince: Date | null;
  pausedMinutes: number;
  registeredMinutes: number | null;
  gps: DisplayGpsStatus;
  lastPositionAt: Date | null;
  distanceM: number | null;
  /** Position för kartan (bara under ett pågående pass). `stale` = äldre än gränsen och får aldrig visas som aktuell. */
  position: { lat: number; lng: number; accuracyM: number | null; stale: boolean } | null;
  needsReview: boolean;
};

export type BollplockareLive = {
  now: Date;
  area: WorkAreaData;
  settings: BollplockareSettingsData;
  today: string;
  people: LivePerson[];
  upcoming: { shiftId: string; date: string; name: string; approvalStatus: string; published: boolean; closeTime: string | null }[];
  deviations: { pauseId: string; entryId: string; name: string; startedAt: Date; endedAt: Date | null; distanceM: number | null; voided: boolean }[];
  month: { year: number; month: number; totals: ReturnType<typeof summarizeByEmployee> };
};

export async function getBollplockareLive(db: DbClient, actor: Actor, now = new Date()): Promise<BollplockareLive> {
  if (!can(actor.role, "worktime:read:all")) throw new ForbiddenError();
  const [settings, area] = await Promise.all([getSettings(db), getWorkArea(db)]);
  const today = stockholmDateOf(now);
  const yesterday = addDaysToDateString(today, -1);

  const shifts = await db.shift.findMany({
    where: { openEnded: true, workStatus: { not: "CANCELLED" }, localDate: { in: [yesterday, today].map(dateStringToDbDate) } },
    include: {
      assignedEmployee: { select: { firstName: true, lastName: true } },
      workTimeEntry: { include: { bollplockareSession: { include: { pauses: true } } } },
    },
    orderBy: { startsAt: "asc" },
  });

  const people: LivePerson[] = [];
  for (const s of shifts) {
    const date = dbDateToString(s.localDate);
    const entry = s.workTimeEntry;
    const session = entry?.bollplockareSession ?? null;
    const open = Boolean(entry && !entry.registeredEndsAt);
    // Gårdagens pass visas bara om det fortfarande pågår.
    if (date === yesterday && !open) continue;
    const day = await getRangeDay(db, date, settings);
    const pauses = (session?.pauses ?? []).map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt, voided: p.voidedAt !== null }));
    const openPause = session?.pauses.find((p) => !p.endedAt && !p.voidedAt) ?? null;
    const stale = session ? isPositionStale(session.lastPositionAt, now, settings.staleAfterSeconds) : true;
    people.push({
      employeeId: s.assignedEmployeeId,
      name: fullName(s.assignedEmployee),
      shiftId: s.id,
      date,
      closeTime: day.closeTime,
      earliestCheckIn: day.earliestCheckIn,
      approvalStatus: s.approvalStatus,
      published: s.publicationStatus === "PUBLISHED",
      state: deriveWorkState({
        now,
        cancelled: false,
        earliestCheckIn: day.earliestCheckIn,
        entry: entry ? { endedAt: entry.registeredEndsAt, openPause: Boolean(openPause), status: entry.status, needsReview: Boolean(session?.needsReview) } : null,
      }),
      entryId: entry?.id ?? null,
      startedAt: entry?.registeredStartsAt ?? null,
      endedAt: entry?.registeredEndsAt ?? null,
      workedSeconds: open && entry?.registeredStartsAt ? liveWorkedSeconds(entry.registeredStartsAt, pauses, now) : null,
      pauseOpenSince: openPause?.startedAt ?? null,
      pausedMinutes: session?.pausedMinutes ?? 0,
      registeredMinutes: entry?.registeredEndsAt ? entry.registeredMinutes : null,
      gps: open && session ? displayGpsStatus(session.gpsStatus, session.lastPositionAt, session.gpsStatusAt, now, settings.staleAfterSeconds) : "NONE",
      lastPositionAt: open ? (session?.lastPositionAt ?? null) : null,
      distanceM: open ? (session?.lastDistanceM ?? null) : null,
      position: open && session && session.lastLat !== null && session.lastLng !== null ? { lat: session.lastLat, lng: session.lastLng, accuracyM: session.lastAccuracyM, stale } : null,
      needsReview: Boolean(session?.needsReview) && !open,
    });
  }

  const upcomingRows = await db.shift.findMany({
    where: { openEnded: true, workStatus: { not: "CANCELLED" }, localDate: { gt: dateStringToDbDate(today), lte: dateStringToDbDate(addDaysToDateString(today, 14)) } },
    include: { assignedEmployee: { select: { firstName: true, lastName: true } } },
    orderBy: [{ localDate: "asc" }, { startsAt: "asc" }],
  });
  const upcoming = await Promise.all(
    upcomingRows.map(async (s) => ({
      shiftId: s.id,
      date: dbDateToString(s.localDate),
      name: fullName(s.assignedEmployee),
      approvalStatus: s.approvalStatus,
      published: s.publicationStatus === "PUBLISHED",
      closeTime: (await getRangeDay(db, dbDateToString(s.localDate), settings)).closeTime,
    })),
  );

  const pauses = await db.gpsPause.findMany({
    where: { startedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
    include: { session: { include: { entry: { include: { employee: { select: { firstName: true, lastName: true } } } } } } },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  const ym = stockholmYearMonth(now);
  const first = `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;
  const last = addDaysToDateString(`${ym.month === 12 ? ym.year + 1 : ym.year}-${String(ym.month === 12 ? 1 : ym.month + 1).padStart(2, "0")}-01`, -1);
  const totals = summarizeByEmployee(await listWorkEntries(db, actor, { from: first, to: last, category: "BOLLPLOCKARE" }));

  return {
    now,
    area,
    settings,
    today,
    people,
    upcoming,
    deviations: pauses.map((p) => ({
      pauseId: p.id,
      entryId: p.session.entryId,
      name: fullName(p.session.entry.employee),
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      distanceM: p.distanceM,
      voided: p.voidedAt !== null,
    })),
    month: { ...ym, totals },
  };
}
