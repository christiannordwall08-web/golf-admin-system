import { type Ring, type Zone, classifyPosition, haversineMeters, isValidLatLng } from "./geo";

/**
 * Tillståndsmaskin för GPS-kontrollen under ett pass. Ren funktion: tar tidigare tillstånd + ny mätning + serverns tid
 * och returnerar nytt tillstånd samt vad som ska hända (pausa, återuppta, logga). Testad i tests/unit/bollplockare-tracking.test.ts.
 *
 * GRUNDREGLER (se docs/BOLLPLOCKARE-GPS.md):
 *  1. En enskild mätning kan aldrig pausa tiden. En avvikelse måste bekräftas av flera pålitliga mätningar under hela verifieringstiden.
 *  2. Osäkra mätningar (dålig noggrannhet, gammal, hopp) och uteblivna mätningar är ALDRIG en avvikelse och rör inte timern.
 *  3. Allt tidsberäknas på SERVERNS klocka. Klientens tidsstämpel används bara för att avgöra om en mätning är gammal.
 *  4. GPS-status (detta) är skild från passets tillstånd: en utebliven GPS-signal pausar eller avslutar aldrig passet.
 */

export type GpsStatus = "NONE" | "INSIDE" | "MARGIN" | "VERIFYING" | "OUTSIDE" | "UNRELIABLE" | "MISSING" | "DENIED";

export type TrackState = {
  gpsStatus: GpsStatus;
  /** Serverns tid för den senast ACCEPTERADE positionen. */
  lastPositionAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracyM: number | null;
  lastDistanceM: number | null;
  /** När pågående verifiering började (avvikelse om inte pausad, återkomst om pausad). */
  trackSince: Date | null;
  trackSamples: number;
  /** Finns en öppen paus? */
  paused: boolean;
};

export type PositionSample =
  | { kind: "position"; lat: number; lng: number; accuracyM: number; /** Klientens tidpunkt för mätningen. */ fixAt: Date | null }
  | { kind: "problem"; problem: "DENIED" | "UNAVAILABLE" | "TIMEOUT" };

export type TrackConfig = {
  rings: readonly Ring[];
  marginM: number;
  verificationSeconds: number;
  maxAccuracyM: number;
  staleAfterSeconds: number;
  returnHysteresisM: number;
  /** Antal pålitliga mätningar utanför som krävs för att bekräfta en avvikelse (minst 2). */
  minOutsideSamples?: number;
  /** Antal pålitliga mätningar inom marginalen som krävs för att återuppta (minst 2). */
  minReturnSamples?: number;
  /** Fysiskt omöjlig hastighet i m/s. Hopp snabbare än så är ett mätfel. */
  maxSpeedMps?: number;
};

export type UnreliableReason = "ACCURACY" | "STALE" | "JUMP" | "INVALID";

export type TrackAction =
  | { type: "PAUSE_START"; at: Date; distanceM: number; lat: number; lng: number; accuracyM: number }
  | { type: "RESUME"; at: Date }
  | { type: "EVENT"; event: "GPS_UNRELIABLE" | "GPS_MISSING" | "GPS_DENIED" | "GPS_RESTORED"; reason?: UnreliableReason | "TIMEOUT" | "UNAVAILABLE" };

export type TrackResult = { next: TrackState; actions: TrackAction[]; zone: Zone | null; reason?: UnreliableReason };

export const INITIAL_TRACK_STATE: TrackState = {
  gpsStatus: "NONE",
  lastPositionAt: null,
  lastLat: null,
  lastLng: null,
  lastAccuracyM: null,
  lastDistanceM: null,
  trackSince: null,
  trackSamples: 0,
  paused: false,
};

const DEFAULT_MAX_SPEED_MPS = 40;
/** Efter så här lång tid utan accepterad mätning används hastighetskontrollen inte (personen kan ha förflyttat sig). */
const JUMP_CHECK_WINDOW_SECONDS = 300;
/** Hopp kortare än så (meter) räknas aldrig som hopp (brus). */
const MIN_JUMP_METERS = 100;
const BAD_STATUSES = new Set<GpsStatus>(["UNRELIABLE", "MISSING", "DENIED"]);

const secondsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 1000;

/** Kontrollerar en mätning och avgör om den är pålitlig. */
function reliability(state: TrackState, s: Extract<PositionSample, { kind: "position" }>, now: Date, cfg: TrackConfig): UnreliableReason | null {
  if (!isValidLatLng(s.lat, s.lng) || !Number.isFinite(s.accuracyM) || s.accuracyM < 0) return "INVALID";
  if (s.accuracyM > cfg.maxAccuracyM) return "ACCURACY";
  // Klientens tidsstämpel får bara göra mätningen "äldre", aldrig nyare än serverns klocka.
  if (s.fixAt && secondsBetween(s.fixAt, now) > cfg.staleAfterSeconds) return "STALE";
  if (state.lastLat !== null && state.lastLng !== null && state.lastPositionAt) {
    const dt = secondsBetween(state.lastPositionAt, now);
    if (dt < JUMP_CHECK_WINDOW_SECONDS) {
      const dist = haversineMeters([state.lastLat, state.lastLng], [s.lat, s.lng]);
      if (dist > MIN_JUMP_METERS && dist / Math.max(dt, 1) > (cfg.maxSpeedMps ?? DEFAULT_MAX_SPEED_MPS)) return "JUMP";
    }
  }
  return null;
}

export function evaluateSample(state: TrackState, sample: PositionSample, now: Date, cfg: TrackConfig): TrackResult {
  const actions: TrackAction[] = [];
  const minOutside = Math.max(2, cfg.minOutsideSamples ?? 2);
  const minReturn = Math.max(2, cfg.minReturnSamples ?? 2);

  // 1. Ingen position alls (nekad åtkomst, signal saknas, tidsgräns): rör inget annat än statusen.
  if (sample.kind === "problem") {
    const status: GpsStatus = sample.problem === "DENIED" ? "DENIED" : "MISSING";
    if (state.gpsStatus !== status) actions.push({ type: "EVENT", event: status === "DENIED" ? "GPS_DENIED" : "GPS_MISSING", reason: sample.problem === "DENIED" ? undefined : sample.problem });
    return { next: { ...state, gpsStatus: status }, actions, zone: null };
  }

  // 2. Osäker mätning: aldrig en avvikelse. Pågående verifiering ligger kvar oförändrad.
  const bad = reliability(state, sample, now, cfg);
  if (bad) {
    if (state.gpsStatus !== "UNRELIABLE") actions.push({ type: "EVENT", event: "GPS_UNRELIABLE", reason: bad });
    return { next: { ...state, gpsStatus: "UNRELIABLE" }, actions, zone: null, reason: bad };
  }

  // 3. Pålitlig mätning.
  const c = classifyPosition([sample.lat, sample.lng], cfg.rings, cfg.marginM, sample.accuracyM);
  const next: TrackState = {
    ...state,
    lastPositionAt: now,
    lastLat: sample.lat,
    lastLng: sample.lng,
    lastAccuracyM: sample.accuracyM,
    lastDistanceM: c.distanceM,
  };
  if (BAD_STATUSES.has(state.gpsStatus)) actions.push({ type: "EVENT", event: "GPS_RESTORED" });

  if (!state.paused) {
    if (c.zone !== "OUTSIDE") {
      // Inom området eller marginalen: ingen avvikelse, återställ pågående verifiering.
      return { next: { ...next, gpsStatus: c.zone, trackSince: null, trackSamples: 0 }, actions, zone: c.zone };
    }
    // Utanför marginalen. Är den förra mätningen gammal (glapp) börjar verifieringen om.
    const continuing =
      state.gpsStatus === "VERIFYING" &&
      state.trackSince !== null &&
      state.lastPositionAt !== null &&
      secondsBetween(state.lastPositionAt, now) <= cfg.staleAfterSeconds;
    const since = continuing ? state.trackSince! : now;
    const samples = continuing ? state.trackSamples + 1 : 1;
    if (samples >= minOutside && secondsBetween(since, now) >= cfg.verificationSeconds) {
      actions.push({ type: "PAUSE_START", at: since, distanceM: c.distanceM, lat: sample.lat, lng: sample.lng, accuracyM: sample.accuracyM });
      return { next: { ...next, gpsStatus: "OUTSIDE", paused: true, trackSince: null, trackSamples: 0 }, actions, zone: c.zone };
    }
    return { next: { ...next, gpsStatus: "VERIFYING", trackSince: since, trackSamples: samples }, actions, zone: c.zone };
  }

  // Pausad: återupptagning kräver att personen med god marginal är tillbaka (hysteres mot fladder vid gränsen).
  const returnLimit = Math.max(0, cfg.marginM - cfg.returnHysteresisM);
  const back = c.zone !== "OUTSIDE" && c.distanceM <= returnLimit;
  if (!back) {
    return { next: { ...next, gpsStatus: c.zone === "OUTSIDE" ? "OUTSIDE" : "MARGIN", trackSince: null, trackSamples: 0 }, actions, zone: c.zone };
  }
  const continuing =
    state.trackSince !== null && state.lastPositionAt !== null && secondsBetween(state.lastPositionAt, now) <= cfg.staleAfterSeconds;
  const since = continuing ? state.trackSince! : now;
  const samples = continuing ? state.trackSamples + 1 : 1;
  if (samples >= minReturn) {
    actions.push({ type: "RESUME", at: since });
    return { next: { ...next, gpsStatus: c.zone, paused: false, trackSince: null, trackSamples: 0 }, actions, zone: c.zone };
  }
  return { next: { ...next, gpsStatus: "OUTSIDE", trackSince: since, trackSamples: samples }, actions, zone: c.zone };
}

/**
 * Hur gammal är senast verifierade position? Används i gränssnitten: en position äldre än `staleAfterSeconds` visas
 * aldrig som aktuell. Returnerar null om ingen position finns.
 */
export function positionAgeSeconds(lastPositionAt: Date | null, now: Date): number | null {
  return lastPositionAt ? Math.max(0, secondsBetween(lastPositionAt, now)) : null;
}

export function isPositionStale(lastPositionAt: Date | null, now: Date, staleAfterSeconds: number): boolean {
  const age = positionAgeSeconds(lastPositionAt, now);
  return age === null || age > staleAfterSeconds;
}

/** Statusen som ska VISAS: en sparad status blir "gammal position" om inget nytt kommit på ett tag. */
export type DisplayGpsStatus = GpsStatus | "STALE";
export function displayGpsStatus(status: GpsStatus, lastPositionAt: Date | null, lastContactAt: Date | null, now: Date, staleAfterSeconds: number): DisplayGpsStatus {
  const lastContact = lastContactAt ?? lastPositionAt;
  if (status === "NONE") return lastContact ? "STALE" : "NONE";
  if (lastContact && secondsBetween(lastContact, now) > staleAfterSeconds) return "STALE";
  return status;
}
