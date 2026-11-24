import { can } from "@/domain/roles";
import { addDaysToDateString, dateStringToDbDate, dbDateToString, formatTime, stockholmDateOf } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { ForbiddenError } from "@/server/errors";
import { fullName } from "@/server/queries/mappers";
import { adminUserIds, notify } from "@/server/services/notifications";
import type { Actor } from "@/server/services/pay-rates";
import { classifyPosition } from "../domain/geo";
import { CLOCK_IN_MESSAGE, type ClockInAvailability, type RangeDay, clockInAvailability } from "../domain/range-time";
import {
  INITIAL_TRACK_STATE,
  type GpsStatus,
  type PositionSample,
  type TrackAction,
  type TrackConfig,
  type TrackState,
  evaluateSample,
} from "../domain/tracking";
import { liveWorkedSeconds, sessionTotals } from "../domain/worktime";
import { type BollplockareSettingsData, type WorkAreaData, getRangeDay, getSettings, getWorkArea } from "./settings";

/**
 * Klocka in/ut och GPS-kontroll för bollplockare. ALLA regler avgörs här på servern; gränssnittet visar bara resultatet.
 *  - Serverns klocka är den enda tidskällan. Klientens position kan bara göra en mätning "äldre", aldrig ändra tiden.
 *  - Allt som kan ske samtidigt från flera flikar/enheter serialiseras med en radlåsning på sessionen plus unika index i databasen.
 *  - Positioner sparas bara under ett pågående pass (senaste mätningen), och koordinaterna rensas vid utcheckning.
 */

export type ClockErrorCode =
  | "NO_SHIFT" | "TOO_EARLY" | "CLOSED_DAY" | "WINDOW_ENDED" | "CANCELLED" | "NOT_PUBLISHED" | "ALREADY_ACTIVE" | "ALREADY_DONE"
  | "AREA_NOT_CONFIGURED" | "GPS_UNRELIABLE" | "OUTSIDE_AREA" | "GPS_REQUIRED" | "NOT_ACTIVE" | "CONFLICT";

export type ClockFailure = { ok: false; code: ClockErrorCode; message: string; secondsUntil?: number; opensAt?: Date; distanceM?: number };

const fail = (code: ClockErrorCode, message: string, extra: Partial<ClockFailure> = {}): ClockFailure => ({ ok: false, code, message, ...extra });

async function bollplockareOf(db: DbClient, actor: Actor) {
  if (!can(actor.role, "worktime:clock")) throw new ForbiddenError();
  const e = await db.employee.findFirst({
    where: { userId: actor.id, category: "BOLLPLOCKARE", status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!e) throw new ForbiddenError("Du har ingen aktiv anställning som bollplockare.");
  return e;
}

function trackConfig(settings: BollplockareSettingsData, area: WorkAreaData): TrackConfig {
  return {
    rings: area.rings,
    marginM: area.marginMeters,
    verificationSeconds: settings.verificationSeconds,
    maxAccuracyM: settings.maxAccuracyMeters,
    staleAfterSeconds: settings.staleAfterSeconds,
    returnHysteresisM: settings.returnHysteresisMeters,
  };
}

/** Passet som gäller just nu: ett pågående, annars dagens, annars gårdagens om arbetsdygnet inte tagit slut. */
export async function findCurrentShift(db: DbClient, employeeId: string, now: Date, settings?: BollplockareSettingsData) {
  const today = stockholmDateOf(now);
  const yesterday = addDaysToDateString(today, -1);
  const shifts = await db.shift.findMany({
    where: {
      assignedEmployeeId: employeeId,
      openEnded: true,
      workStatus: { not: "CANCELLED" },
      localDate: { in: [dateStringToDbDate(yesterday), dateStringToDbDate(today)] },
    },
    include: { workTimeEntry: { include: { bollplockareSession: { include: { pauses: true } } } } },
    orderBy: { localDate: "asc" },
  });
  const s = settings ?? (await getSettings(db));
  const withDay = await Promise.all(shifts.map(async (shift) => ({ shift, day: await getRangeDay(db, dbDateToString(shift.localDate), s) })));
  return (
    withDay.find((x) => x.shift.workTimeEntry && !x.shift.workTimeEntry.registeredEndsAt) ??
    withDay.find((x) => dbDateToString(x.shift.localDate) === today) ??
    withDay.find((x) => now < x.day.windowEnd) ??
    null
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Tillstånd för bollplockarens panel
// ---------------------------------------------------------------------------------------------------------------------

export type ActiveSnapshot = {
  entryId: string;
  shiftId: string;
  startedAt: Date;
  /** Arbetad tid just nu enligt serverns klocka (pausad tid ingår inte). */
  workedSeconds: number;
  pausedSeconds: number;
  pauseOpenSince: Date | null;
  pauseCount: number;
  gpsStatus: GpsStatus;
  lastPositionAt: Date | null;
  lastDistanceM: number | null;
  lastContactAt: Date | null;
  serverNow: Date;
};

export type FinishedSummary = {
  entryId: string;
  startedAt: Date;
  endedAt: Date;
  totalMinutes: number;
  pausedMinutes: number;
  registeredMinutes: number;
  status: "PRELIMINARY" | "APPROVED" | "CORRECTED" | "ABSENT" | "VOID";
};

export type MyClockState = {
  employee: { id: string; firstName: string };
  serverNow: Date;
  settings: Pick<BollplockareSettingsData, "verificationSeconds" | "staleAfterSeconds" | "maxAccuracyMeters" | "checkInMarginMinutes">;
  areaConfigured: boolean;
  /** Dagens (eller pågående) pass, eller null. */
  shift: { id: string; date: string; approvalStatus: "PENDING" | "APPROVED" | "CHANGE_REQUESTED" | "APPROVED_AFTER_SWAP"; day: RangeDay } | null;
  availability: ClockInAvailability;
  active: ActiveSnapshot | null;
  finished: FinishedSummary | null;
};

function toActive(
  shiftId: string,
  entry: { id: string; registeredStartsAt: Date | null },
  session: { gpsStatus: GpsStatus; lastPositionAt: Date | null; lastDistanceM: number | null; gpsStatusAt: Date | null; pauses: { startedAt: Date; endedAt: Date | null; voidedAt: Date | null }[] },
  now: Date,
): ActiveSnapshot {
  const startedAt = entry.registeredStartsAt!;
  const pauses = session.pauses.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt, voided: p.voidedAt !== null }));
  const worked = liveWorkedSeconds(startedAt, pauses, now);
  const open = session.pauses.find((p) => !p.endedAt && !p.voidedAt) ?? null;
  return {
    entryId: entry.id,
    shiftId,
    startedAt,
    workedSeconds: worked,
    pausedSeconds: Math.max(0, (now.getTime() - startedAt.getTime()) / 1000 - worked),
    pauseOpenSince: open?.startedAt ?? null,
    pauseCount: session.pauses.filter((p) => !p.voidedAt).length,
    gpsStatus: session.gpsStatus,
    lastPositionAt: session.lastPositionAt,
    lastDistanceM: session.lastDistanceM,
    lastContactAt: session.gpsStatusAt,
    serverNow: now,
  };
}

/** Allt panelen behöver för att visa rätt läge direkt vid sidladdning (ingen JavaScript-timer är källa till sanning). */
export async function getMyClockState(db: DbClient, actor: Actor, now = new Date()): Promise<MyClockState> {
  const employee = await bollplockareOf(db, actor);
  const [settings, area] = await Promise.all([getSettings(db), getWorkArea(db)]);
  const current = await findCurrentShift(db, employee.id, now, settings);
  const entry = current?.shift.workTimeEntry ?? null;
  const session = entry?.bollplockareSession ?? null;
  const open = entry && !entry.registeredEndsAt;
  const availability = clockInAvailability({
    now,
    day: current?.day ?? null,
    shift: current ? { cancelled: current.shift.workStatus === "CANCELLED", published: current.shift.publicationStatus === "PUBLISHED" } : null,
    hasActiveEntry: Boolean(open),
    hasFinishedEntry: Boolean(entry?.registeredEndsAt),
  });
  return {
    employee: { id: employee.id, firstName: employee.firstName },
    serverNow: now,
    settings: {
      verificationSeconds: settings.verificationSeconds,
      staleAfterSeconds: settings.staleAfterSeconds,
      maxAccuracyMeters: settings.maxAccuracyMeters,
      checkInMarginMinutes: settings.checkInMarginMinutes,
    },
    areaConfigured: area.configured,
    shift: current ? { id: current.shift.id, date: dbDateToString(current.shift.localDate), approvalStatus: current.shift.approvalStatus, day: current.day } : null,
    availability,
    active: open && entry && session ? toActive(current!.shift.id, entry, session, now) : null,
    finished:
      entry?.registeredEndsAt && entry.registeredStartsAt
        ? {
            entryId: entry.id,
            startedAt: entry.registeredStartsAt,
            endedAt: entry.registeredEndsAt,
            totalMinutes: Math.round((entry.registeredEndsAt.getTime() - entry.registeredStartsAt.getTime()) / 60_000),
            pausedMinutes: session?.pausedMinutes ?? 0,
            registeredMinutes: entry.registeredMinutes,
            status: entry.status,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Klocka in
// ---------------------------------------------------------------------------------------------------------------------

const looksLikeUniqueViolation = (e: unknown) => /one_open_gps_per_employee|WorkTimeEntry_shiftId_key|23505|Unique constraint/i.test(e instanceof Error ? e.message : String(e));

export async function clockIn(
  db: PrismaClient,
  actor: Actor,
  input: { sample: PositionSample; now?: Date },
): Promise<({ ok: true; entryId: string; zone: "INSIDE" | "MARGIN"; startedAt: Date }) | ClockFailure> {
  const employee = await bollplockareOf(db, actor);
  const now = input.now ?? new Date();
  const [settings, area] = await Promise.all([getSettings(db), getWorkArea(db)]);
  const current = await findCurrentShift(db, employee.id, now, settings);

  const availability = clockInAvailability({
    now,
    day: current?.day ?? null,
    shift: current ? { cancelled: current.shift.workStatus === "CANCELLED", published: current.shift.publicationStatus === "PUBLISHED" } : null,
    hasActiveEntry: Boolean(current?.shift.workTimeEntry && !current.shift.workTimeEntry.registeredEndsAt),
    hasFinishedEntry: Boolean(current?.shift.workTimeEntry?.registeredEndsAt),
  });
  if (availability.status === "TOO_EARLY") {
    return fail("TOO_EARLY", `Incheckning öppnar om ${Math.ceil(availability.secondsUntil / 60)} minuter.`, { secondsUntil: availability.secondsUntil, opensAt: availability.opensAt });
  }
  if (availability.status !== "AVAILABLE") return fail(availability.status, CLOCK_IN_MESSAGE[availability.status]);
  const { shift, day } = current!;

  // GPS: krävs, måste vara pålitlig och inom området (zon 1) eller säkerhetsmarginalen (zon 2).
  if (!area.configured) return fail("AREA_NOT_CONFIGURED", "Arbetsområdet är inte inställt än. Kontakta admin.");
  if (input.sample.kind !== "position") {
    return fail("GPS_REQUIRED", input.sample.problem === "DENIED" ? "Du måste tillåta platsåtkomst för att kunna klocka in." : "Din position kunde inte hämtas. Kontrollera GPS och försök igen.");
  }
  const cfg = trackConfig(settings, area);
  const evaluated = evaluateSample({ ...INITIAL_TRACK_STATE }, input.sample, now, cfg);
  if (evaluated.next.gpsStatus === "UNRELIABLE") {
    return fail("GPS_UNRELIABLE", `GPS-positionen är för osäker (${evaluated.reason === "ACCURACY" ? `±${Math.round(input.sample.accuracyM)} m` : "gammal eller ogiltig mätning"}). Gå till en plats med bättre mottagning och försök igen.`);
  }
  const zone = classifyPosition([input.sample.lat, input.sample.lng], area.rings, area.marginMeters, input.sample.accuracyM);
  if (zone.zone === "OUTSIDE") {
    return fail("OUTSIDE_AREA", `Du befinner dig ${Math.round(zone.distanceM)} m utanför arbetsområdet (tillåten marginal ${area.marginMeters} m). Du kan bara klocka in på golfanläggningen.`, { distanceM: zone.distanceM });
  }

  const earliest = day.earliestCheckIn!;
  try {
    return await db.$transaction(async (tx) => {
      const entry = await tx.workTimeEntry.create({
        data: {
          shiftId: shift.id,
          employeeId: employee.id,
          workDate: shift.localDate,
          category: "BOLLPLOCKARE",
          source: "GPS",
          status: "PRELIMINARY",
          scheduledStartsAt: earliest,
          scheduledEndsAt: day.windowEnd,
          scheduledMinutes: 0,
          registeredStartsAt: now,
          registeredMinutes: 0,
        },
      });
      const session = await tx.bollplockareSession.create({
        data: {
          entryId: entry.id,
          gpsStatus: zone.zone === "INSIDE" ? "INSIDE" : "MARGIN",
          gpsStatusAt: now,
          lastPositionAt: now,
          lastLat: input.sample.kind === "position" ? input.sample.lat : null,
          lastLng: input.sample.kind === "position" ? input.sample.lng : null,
          lastAccuracyM: input.sample.kind === "position" ? input.sample.accuracyM : null,
          lastDistanceM: zone.distanceM,
        },
      });
      await tx.gpsEvent.create({
        data: { sessionId: session.id, type: "CLOCK_IN", at: now, actorId: actor.id, data: { zone: zone.zone, distanceM: Math.round(zone.distanceM), accuracyM: Math.round(input.sample.kind === "position" ? input.sample.accuracyM : 0) } },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "BOLLPLOCKARE_CLOCK_IN",
        entityType: "WorkTimeEntry",
        entityId: entry.id,
        after: { shiftId: shift.id, startedAt: now.toISOString(), zone: zone.zone },
      });
      await notify(tx, {
        userIds: await adminUserIds(tx),
        type: "WORK_CLOCKED_IN",
        title: `${fullName(employee)} klockade in`,
        body: `Incheckning ${formatTime(now)} (rangen stänger ${day.closeTime?.replace(":", ".")}). Status: ${zone.zone === "INSIDE" ? "inom området" : "inom säkerhetsmarginalen"}.`,
        linkPath: `/admin/bollplockare/pass/${entry.id}`,
        entityType: "WorkTimeEntry",
        entityId: entry.id,
      });
      return { ok: true as const, entryId: entry.id, zone: (zone.zone === "INSIDE" ? "INSIDE" : "MARGIN") as "INSIDE" | "MARGIN", startedAt: now };
    });
  } catch (e) {
    if (looksLikeUniqueViolation(e)) return fail("ALREADY_ACTIVE", "Du är redan incheckad (på en annan flik eller enhet).");
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Positionsrapport under ett pågående pass
// ---------------------------------------------------------------------------------------------------------------------

export type PositionReportResult =
  | { ok: true; snapshot: ActiveSnapshot; zone: string | null; reason?: string }
  | ClockFailure;

async function openSessionFor(db: DbClient, employeeId: string) {
  return db.workTimeEntry.findFirst({
    where: { employeeId, source: "GPS", registeredEndsAt: null },
    include: { bollplockareSession: { include: { pauses: true } }, shift: { select: { id: true } } },
  });
}

const sv = (n: number) => `${Math.round(n)} meter`;

/**
 * Tar emot en mätning (eller ett GPS-problem) från bollplockarens webbläsare. Utan pågående pass avvisas den
 * (klienten slutar då följa positionen): ingen position registreras någonsin utanför ett pass.
 */
export async function reportPosition(db: PrismaClient, actor: Actor, input: { sample: PositionSample; now?: Date }): Promise<PositionReportResult> {
  const employee = await bollplockareOf(db, actor);
  const now = input.now ?? new Date();
  const [settings, area] = await Promise.all([getSettings(db), getWorkArea(db)]);
  const cfg = trackConfig(settings, area);

  const open = await openSessionFor(db, employee.id);
  if (!open?.bollplockareSession) return fail("NOT_ACTIVE", "Du har inget pågående arbetspass. Positionen följs inte.");
  const sessionId = open.bollplockareSession.id;

  return db.$transaction(async (tx) => {
    // Serialisera samtidiga rapporter (flera flikar/enheter): bara en i taget bearbetar sessionen.
    await tx.$queryRaw`SELECT id FROM "BollplockareSession" WHERE id = ${sessionId} FOR UPDATE`;
    const session = await tx.bollplockareSession.findUniqueOrThrow({ where: { id: sessionId }, include: { pauses: true, entry: true } });
    if (session.entry.registeredEndsAt) return fail("NOT_ACTIVE", "Arbetspasset är redan avslutat.");

    const openPause = session.pauses.find((p) => !p.endedAt && !p.voidedAt) ?? null;
    const state: TrackState = {
      gpsStatus: session.gpsStatus,
      lastPositionAt: session.lastPositionAt,
      lastLat: session.lastLat,
      lastLng: session.lastLng,
      lastAccuracyM: session.lastAccuracyM,
      lastDistanceM: session.lastDistanceM,
      trackSince: session.trackSince,
      trackSamples: session.trackSamples,
      paused: Boolean(openPause),
    };

    // Utan arbetsområde kan inget avgöras: registrera bara kontakten, aldrig en avvikelse.
    const result = area.configured ? evaluateSample(state, input.sample, now, cfg) : { next: { ...state, gpsStatus: "UNRELIABLE" as GpsStatus }, actions: [] as TrackAction[], zone: null };

    const n = result.next;
    await tx.bollplockareSession.update({
      where: { id: sessionId },
      data: {
        gpsStatus: n.gpsStatus,
        gpsStatusAt: now,
        lastPositionAt: n.lastPositionAt,
        lastLat: n.lastLat,
        lastLng: n.lastLng,
        lastAccuracyM: n.lastAccuracyM,
        lastDistanceM: n.lastDistanceM,
        trackSince: n.trackSince,
        trackSamples: n.trackSamples,
      },
    });

    const admins = await adminUserIds(tx);
    const name = fullName(employee);
    const link = `/admin/bollplockare/pass/${session.entryId}`;
    for (const a of result.actions) {
      if (a.type === "PAUSE_START") {
        await tx.gpsPause.create({ data: { sessionId, startedAt: a.at, distanceM: a.distanceM, lat: a.lat, lng: a.lng, accuracyM: a.accuracyM } });
        await tx.gpsEvent.create({ data: { sessionId, type: "PAUSE_STARTED", at: a.at, data: { distanceM: Math.round(a.distanceM), accuracyM: Math.round(a.accuracyM), marginM: area.marginMeters } } });
        await tx.bollplockareSession.update({ where: { id: sessionId }, data: { needsReview: true, reviewReasons: { set: [...new Set([...session.reviewReasons, "Geografisk paus"])] } } });
        await notify(tx, {
          userIds: [actor.id],
          type: "WORK_PAUSED",
          title: "Din arbetstid är pausad",
          body: `Du befinner dig utanför golfanläggningen (${sv(a.distanceM)} från gränsen). Tiden fortsätter automatiskt när du är tillbaka.`,
          linkPath: "/bollplockare",
          entityType: "WorkTimeEntry",
          entityId: session.entryId,
        });
        await notify(tx, {
          userIds: admins,
          type: "WORK_PAUSED",
          title: "Bollplockare har lämnat arbetsområdet",
          body: `Anställd: ${name} · Tidpunkt: ${formatTime(a.at)} · Avstånd från golfanläggningens gräns: ${sv(a.distanceM)} · Tillåten säkerhetsmarginal: ${area.marginMeters} meter · Status: Arbetstid pausad`,
          linkPath: link,
          entityType: "WorkTimeEntry",
          entityId: session.entryId,
        });
      } else if (a.type === "RESUME" && openPause) {
        const endedAt = a.at.getTime() > openPause.startedAt.getTime() ? a.at : new Date(openPause.startedAt.getTime() + 1);
        await tx.gpsPause.update({ where: { id: openPause.id }, data: { endedAt, endedBy: "RETURNED" } });
        const minutes = Math.round((endedAt.getTime() - openPause.startedAt.getTime()) / 60_000);
        await tx.gpsEvent.create({ data: { sessionId, type: "PAUSE_ENDED", at: endedAt, data: { pauseMinutes: minutes } } });
        await notify(tx, {
          userIds: [actor.id],
          type: "WORK_RESUMED",
          title: "Din arbetstid fortsätter",
          body: `Du är tillbaka inom området. Pausen varade ${minutes} min.`,
          linkPath: "/bollplockare",
          entityType: "WorkTimeEntry",
          entityId: session.entryId,
        });
        await notify(tx, {
          userIds: admins,
          type: "WORK_RESUMED",
          title: "Bollplockare har återvänt till arbetsområdet",
          body: `Anställd: ${name} · Tidpunkt: ${formatTime(endedAt)} · Paus: ${minutes} min · Status: Arbetstid återupptagen`,
          linkPath: link,
          entityType: "WorkTimeEntry",
          entityId: session.entryId,
        });
      } else if (a.type === "EVENT") {
        await tx.gpsEvent.create({ data: { sessionId, type: a.event, at: now, data: a.reason ? { reason: a.reason } : undefined } });
      }
    }

    const fresh = await tx.bollplockareSession.findUniqueOrThrow({ where: { id: sessionId }, include: { pauses: true, entry: true } });
    return { ok: true as const, snapshot: toActive(session.entry.shiftId, fresh.entry, fresh, now), zone: result.zone, reason: result.reason };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Klocka ut
// ---------------------------------------------------------------------------------------------------------------------

export type ClockOutResult = ({ ok: true } & FinishedSummary) | ClockFailure;

/** Avslutar passet. Går alltid att göra, även utan GPS och under en paus. GPS-spårningen upphör direkt. */
export async function clockOut(db: PrismaClient, actor: Actor, input: { now?: Date } = {}): Promise<ClockOutResult> {
  const employee = await bollplockareOf(db, actor);
  const now = input.now ?? new Date();
  const open = await openSessionFor(db, employee.id);
  if (!open?.bollplockareSession) return fail("NOT_ACTIVE", "Du är inte incheckad (kanske har du redan klockat ut på en annan flik eller enhet).");
  const sessionId = open.bollplockareSession.id;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BollplockareSession" WHERE id = ${sessionId} FOR UPDATE`;
    const session = await tx.bollplockareSession.findUniqueOrThrow({ where: { id: sessionId }, include: { pauses: true, entry: true } });
    const entry = session.entry;
    if (entry.registeredEndsAt || !entry.registeredStartsAt) return fail("NOT_ACTIVE", "Arbetspasset är redan avslutat.");

    // Utcheckning kan aldrig ligga före incheckning, även om klockan skulle gå fel.
    const endedAt = now.getTime() > entry.registeredStartsAt.getTime() ? now : new Date(entry.registeredStartsAt.getTime());

    // Pågående paus avslutas vid utcheckning.
    const openPause = session.pauses.find((p) => !p.endedAt && !p.voidedAt);
    if (openPause) {
      const pauseEnd = endedAt.getTime() > openPause.startedAt.getTime() ? endedAt : new Date(openPause.startedAt.getTime() + 1);
      await tx.gpsPause.update({ where: { id: openPause.id }, data: { endedAt: pauseEnd, endedBy: "CLOCKED_OUT" } });
      openPause.endedAt = pauseEnd;
    }
    const totals = sessionTotals({
      startedAt: entry.registeredStartsAt,
      endedAt,
      pauses: session.pauses.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt, voided: p.voidedAt !== null })),
    });

    const { count } = await tx.workTimeEntry.updateMany({
      where: { id: entry.id, registeredEndsAt: null },
      data: { registeredEndsAt: endedAt, registeredMinutes: totals.registeredMinutes, version: { increment: 1 } },
    });
    if (count === 0) return fail("CONFLICT", "Passet avslutades just nu på en annan flik eller enhet.");
    await tx.shift.update({ where: { id: entry.shiftId }, data: { workStatus: "COMPLETED", version: { increment: 1 } } });

    const reasons = new Set(session.reviewReasons);
    if (totals.pausedMinutes > 0 || session.pauses.some((p) => !p.voidedAt)) reasons.add("Geografisk paus");
    if (session.clockOutReminderSentAt) reasons.add("Påmind om utcheckning");
    if (totals.registeredMinutes < 10) reasons.add("Mycket kort tid");
    if (totals.registeredMinutes > 12 * 60) reasons.add("Mycket lång tid");
    await tx.bollplockareSession.update({
      where: { id: sessionId },
      data: {
        pausedMinutes: totals.pausedMinutes,
        needsReview: reasons.size > 0,
        reviewReasons: { set: [...reasons] },
        // GPS-spårningen avslutas direkt: inga koordinater eller zonstatus sparas efter utcheckning.
        gpsStatus: "NONE",
        lastLat: null,
        lastLng: null,
        lastAccuracyM: null,
        lastDistanceM: null,
        trackSince: null,
        trackSamples: 0,
      },
    });
    await tx.gpsEvent.create({
      data: { sessionId, type: "CLOCK_OUT", at: endedAt, actorId: actor.id, data: { totalMinutes: totals.totalMinutes, pausedMinutes: totals.pausedMinutes, registeredMinutes: totals.registeredMinutes } },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "BOLLPLOCKARE_CLOCK_OUT",
      entityType: "WorkTimeEntry",
      entityId: entry.id,
      after: { endedAt: endedAt.toISOString(), registeredMinutes: totals.registeredMinutes, pausedMinutes: totals.pausedMinutes },
    });
    const h = Math.floor(totals.registeredMinutes / 60);
    await notify(tx, {
      userIds: await adminUserIds(tx),
      type: "WORK_CLOCKED_OUT",
      title: `${fullName(employee)} klockade ut`,
      body: `${formatTime(entry.registeredStartsAt)}–${formatTime(endedAt)} · registrerad tid ${h} h ${totals.registeredMinutes % 60} min${totals.pausedMinutes ? ` (paus ${totals.pausedMinutes} min)` : ""}.`,
      linkPath: `/admin/bollplockare/pass/${entry.id}`,
      entityType: "WorkTimeEntry",
      entityId: entry.id,
    });
    return {
      ok: true as const,
      entryId: entry.id,
      startedAt: entry.registeredStartsAt,
      endedAt,
      totalMinutes: totals.totalMinutes,
      pausedMinutes: totals.pausedMinutes,
      registeredMinutes: totals.registeredMinutes,
      status: entry.status,
    };
  });
}
