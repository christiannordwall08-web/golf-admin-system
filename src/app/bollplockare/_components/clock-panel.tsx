"use client";

import { AlertTriangle, CheckCircle2, Clock, LogOut, MapPin, Navigation, PauseCircle, Play, ShieldCheck, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import type { PanelSnapshot, PanelState } from "@/modules/bollplockare/server/panel";
import { type PositionCheck, type SampleInput, checkPositionAction, clockInAction, clockOutAction, reportPositionAction } from "../actions";
import { GPS_LABEL, TONE_CLASS, type Tone, ageText, formatHms, formatMinutes, hhmm } from "./gps-labels";
import { GpsSimulator, type Scenario, type SimPoints } from "./gps-simulator";

const REPORT_INTERVAL_MS = 15_000;
const CHECK_INTERVAL_MS = 20_000;

/** En mätning från webbläsarens GPS (eller en simulerad i förhandsvisningen). */
async function readSample(scenario: Scenario, sim: SimPoints | null): Promise<SampleInput> {
  if (scenario !== "REAL" && sim) {
    const now = Date.now();
    switch (scenario) {
      case "INSIDE": return { kind: "position", lat: sim.inside[0], lng: sim.inside[1], accuracyM: 6, fixAtMs: now };
      case "MARGIN": return { kind: "position", lat: sim.margin[0], lng: sim.margin[1], accuracyM: 6, fixAtMs: now };
      case "OUTSIDE": return { kind: "position", lat: sim.outside[0], lng: sim.outside[1], accuracyM: 6, fixAtMs: now };
      case "BAD_ACCURACY": return { kind: "position", lat: sim.outside[0], lng: sim.outside[1], accuracyM: 300, fixAtMs: now };
      case "JUMP": return { kind: "position", lat: sim.far[0], lng: sim.far[1], accuracyM: 6, fixAtMs: now };
      case "STALE": return { kind: "position", lat: sim.inside[0], lng: sim.inside[1], accuracyM: 6, fixAtMs: now - 10 * 60_000 };
      case "NO_SIGNAL": return { kind: "problem", problem: "UNAVAILABLE" };
      case "DENIED": return { kind: "problem", problem: "DENIED" };
    }
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) return { kind: "problem", problem: "UNAVAILABLE" };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ kind: "position", lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, fixAtMs: p.timestamp }),
      (e) => resolve({ kind: "problem", problem: e.code === 1 ? "DENIED" : e.code === 3 ? "TIMEOUT" : "UNAVAILABLE" }),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
  });
}


/** Gemensam klocka som tickar två gånger per sekund (för timer och nedräkning). Ren extern store, inga timers i renderingen. */
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();
function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 500);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}
/** Vald simulering (endast förhandsvisning) lagras i sessionStorage utan att ge hydreringsskillnad (servern renderar alltid "REAL"). */
const SIM_KEY = "golf_sim_scenario";
let simMemory: Scenario = "REAL";
const simListeners = new Set<() => void>();
const subscribeSim = (cb: () => void) => {
  simListeners.add(cb);
  return () => void simListeners.delete(cb);
};
function getSim(): Scenario {
  try {
    return (sessionStorage.getItem(SIM_KEY) as Scenario | null) ?? simMemory;
  } catch {
    return simMemory;
  }
}
function setSim(s: Scenario) {
  simMemory = s;
  try {
    sessionStorage.setItem(SIM_KEY, s);
  } catch {
    /* sessionStorage kan saknas (privat läge) */
  }
  simListeners.forEach((l) => l());
}
const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

type Pending = "in" | "out" | null;

/** Remountas av sidan vid varje serveruppdatering (key), så att panelen alltid startar från serverns läge. */
export function ClockPanel({ initial, simulation }: { initial: PanelState; simulation: SimPoints | null }) {
  return <ClockPanelInner key={initial.serverNow} initial={initial} simulation={simulation} />;
}

function ClockPanelInner({ initial, simulation }: { initial: PanelState; simulation: SimPoints | null }) {
  const router = useRouter();
  const state = initial;
  // Läget vid mottagandet (serverns tid + klientens klocka då). Timern räknas därifrån, så klientens klocka aldrig jämförs mot serverns.
  const [base, setBase] = useState<{ snap: PanelSnapshot | null; at: number }>(() => ({ snap: initial.active, at: Date.now() }));
  const [countdownBase] = useState(() => ({ seconds: initial.availability.secondsUntil ?? 0, at: Date.now() }));
  const scenario = useSyncExternalStore(subscribeSim, getSim, () => "REAL" as Scenario);
  const navOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const online = navOnline && !fetchFailed;
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [check, setCheck] = useState<PositionCheck | { ok: false; message: string; denied?: boolean } | null>(null);
  const [summary, setSummary] = useState<{ totalMinutes: number; pausedMinutes: number; registeredMinutes: number; startedAt: string; endedAt: string } | null>(null);
  const nowMs = useSyncExternalStore(subscribeClock, () => clockNow, () => 0);
  const inFlight = useRef(false);
  const scenarioRef = useRef(scenario);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  const active = base.snap;
  const paused = Boolean(active?.pauseOpenSince);
  const elapsed = nowMs ? (nowMs - base.at) / 1000 : 0;
  const workedNow = active ? active.workedSeconds + (paused ? 0 : elapsed) : 0;
  const secondsUntilOpen = Math.max(0, countdownBase.seconds - (nowMs ? (nowMs - countdownBase.at) / 1000 : 0));
  // Serverns uppskattade tid nu (för "senast verifierad för X sedan"), utan att jämföra klientens klocka med serverns.
  const serverNowEst = active ? Date.parse(active.serverNow) + elapsed * 1000 : 0;

  // Nedräkningen når noll: hämta nytt läge så att "Klocka in" aktiveras.
  const needsRefresh = state.availability.status === "TOO_EARLY" && nowMs > 0 && secondsUntilOpen <= 0;
  useEffect(() => {
    if (needsRefresh) router.refresh();
  }, [needsRefresh, router]);

  // Under ett pågående pass: skicka position var 15:e sekund (och direkt när fliken blir synlig igen).
  const report = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const sample = await readSample(scenarioRef.current, simulation);
      const r = await reportPositionAction(sample);
      setFetchFailed(false);
      if (r.ok && r.snapshot) {
        setBase({ snap: r.snapshot, at: Date.now() });
      } else if (!r.ok && r.code === "NOT_ACTIVE") {
        router.refresh();
      }
    } catch {
      setFetchFailed(true); // ingen uppkoppling: tiden räknas ändå på servern
    } finally {
      inFlight.current = false;
    }
  }, [router, simulation]);

  useEffect(() => {
    if (!state.active) return;
    const first = setTimeout(() => void report(), 0); // direkt vid start, sedan var 15:e sekund
    const id = setInterval(() => void report(), REPORT_INTERVAL_MS);
    const vis = () => document.visibilityState === "visible" && void report();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("online", vis);
    // Håll skärmen tänd under passet så att positionen kan följas (stöds inte överallt).
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("online", vis);
      void lock?.release().catch(() => undefined);
    };
  }, [state.active, report]);

  // Innan incheckning: visa var man är i förhållande till området (sparas inte).
  const canTryClockIn = state.availability.status === "AVAILABLE" || state.availability.status === "TOO_EARLY";
  useEffect(() => {
    if (state.active || !canTryClockIn || state.finished) return;
    let stop = false;
    const run = async () => {
      const sample = await readSample(scenarioRef.current, simulation);
      if (stop) return;
      if (sample.kind === "problem") {
        setCheck({ ok: false, message: sample.problem === "DENIED" ? "Platsåtkomst nekad. Tillåt plats för den här sidan i webbläsarens inställningar." : "Ingen GPS-position hittades än.", denied: sample.problem === "DENIED" });
        return;
      }
      try {
        const r = await checkPositionAction(sample);
        if (!stop) {
          setCheck(r);
          setFetchFailed(false);
        }
      } catch {
        if (!stop) setFetchFailed(true);
      }
    };
    void run();
    const id = setInterval(() => void run(), CHECK_INTERVAL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [state.active, state.finished, canTryClockIn, simulation, scenario]);

  async function doClockIn() {
    setPending("in");
    setError(null);
    try {
      const sample = await readSample(scenarioRef.current, simulation);
      const r = await clockInAction(sample);
      if (r.ok) router.refresh();
      else setError({ code: r.code, message: r.message });
    } catch {
      setError({ code: "NETWORK", message: "Ingen internetuppkoppling. Försök igen när du är online." });
    } finally {
      setPending(null);
    }
  }

  async function doClockOut() {
    setPending("out");
    setError(null);
    try {
      const r = await clockOutAction();
      if (r.ok && r.finished) {
        setSummary(r.finished);
        setBase({ snap: null, at: Date.now() });
        setConfirmOut(false);
        router.refresh();
      } else if (!r.ok) {
        setError({ code: r.code, message: r.message });
        if (r.code === "NOT_ACTIVE") router.refresh();
      }
    } catch {
      setError({ code: "NETWORK", message: "Ingen internetuppkoppling. Din arbetstid räknas fortfarande. Försök klocka ut igen när du är online." });
    } finally {
      setPending(null);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Visning
  // ------------------------------------------------------------------------------------------------------------------
  const sim = simulation ? <GpsSimulator scenario={scenario} onChange={setSim} /> : null;
  const shift = state.shift;
  const dayLine = shift ? (
    <p className="text-sm text-ink-muted">
      Rangen stänger <b className="text-ink">{shift.closeTime?.replace(":", ".") ?? "–"}</b>
      {shift.earliestCheckIn ? <> · Du kan klocka in från <b className="text-ink">{hhmm(shift.earliestCheckIn)}</b></> : null}
    </p>
  ) : null;

  // A. Pågående pass
  if (active) {
    const gps = GPS_LABEL[active.gps];
    const view: { tone: Tone; title: string; detail: string } = paused
      ? { tone: "red", title: "Arbetstiden är pausad", detail: "Du är utanför golfanläggningen. Tiden fortsätter automatiskt när du är tillbaka. Du kan alltid klocka ut." }
      : !online
        ? { tone: "orange", title: "Ingen internetuppkoppling", detail: "Din arbetstid räknas ändå. Positionen uppdateras när du är online igen." }
        : active.gps === "VERIFYING"
          ? { tone: "yellow", title: "Verifierar din position", detail: "Du verkar ha lämnat området. Går du tillbaka pausas inte tiden." }
          : gps.tone === "orange"
            ? { tone: "orange", title: gps.label, detail: "Din arbetstid räknas som vanligt. Se till att GPS är på och att sidan är öppen." }
            : active.gps === "NONE"
              ? { tone: "yellow", title: "Väntar på första positionen", detail: "Din arbetstid räknas." }
              : { tone: "green", title: "Du arbetar", detail: gps.label };
    const t = TONE_CLASS[view.tone];
    const age = active.lastPositionAt ? Math.max(0, (serverNowEst - Date.parse(active.lastPositionAt)) / 1000) : null;
    return (
      <section aria-label="Pågående arbetspass" className="flex flex-col gap-4">
        <div className={cn("rounded-2xl border-2 p-5 text-center", t.card)} aria-live="polite">
          <p className={cn("flex items-center justify-center gap-2 text-sm font-semibold", t.text)}>
            <span className={cn("size-2.5 rounded-full", t.dot, view.tone === "green" && "animate-pulse")} aria-hidden />
            {view.title}
          </p>
          <p className="mt-3 text-6xl font-semibold tracking-tight tabular-nums" role="timer" aria-label="Pågående arbetstid">{formatHms(workedNow)}</p>
          <p className="mt-1 text-xs text-ink-muted">{paused ? "Arbetstid (pausad)" : "Arbetstid"}</p>
          <p className={cn("mt-3 text-sm", t.text)}>{view.detail}</p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Fact label="Incheckad" value={hhmm(active.startedAt)} />
          <Fact label="Paustid" value={formatMinutes(Math.round(active.pausedSeconds / 60)) + (active.pauseCount ? ` (${active.pauseCount})` : "")} />
          <Fact label="GPS-status" value={gps.label} />
          <Fact label="Senast verifierad" value={active.lastPositionAt ? `${hhmm(active.lastPositionAt)}${age !== null ? ` (${ageText(age)})` : ""}` : "–"} />
        </dl>

        {error ? <ErrorBox message={error.message} /> : null}
        {confirmOut ? (
          <div className="rounded-2xl border-2 border-danger-200 bg-white p-4" role="alertdialog" aria-label="Bekräfta utcheckning">
            <p className="mb-3 text-center text-base font-semibold">Är alla bollar plockade?</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setConfirmOut(false)} className="h-14 rounded-xl border border-line bg-white text-base font-medium">Nej, fortsätt</button>
              <button type="button" disabled={pending === "out"} onClick={doClockOut} className="h-14 rounded-xl bg-danger-600 text-base font-semibold text-white disabled:opacity-60">
                {pending === "out" ? "Klockar ut…" : "Ja, klocka ut"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmOut(true)} className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-danger-600 text-xl font-semibold text-white shadow-card active:bg-danger-700">
            <LogOut className="size-6" aria-hidden /> Klocka ut
          </button>
        )}
        <p className="text-center text-xs text-ink-muted">Positionen följs bara under det här passet och slutar följas direkt när du klockar ut.</p>
        {sim}
      </section>
    );
  }

  // B. Klar (sammanfattning)
  const fin = summary ?? state.finished;
  if (fin) {
    return (
      <section aria-label="Arbetspasset är slutfört" className="flex flex-col gap-4">
        <div className="rounded-2xl border-2 border-brand-300 bg-brand-50 p-5 text-center">
          <CheckCircle2 className="mx-auto size-10 text-brand-700" aria-hidden />
          <h2 className="mt-2 text-xl font-semibold text-brand-900">Bra jobbat, passet är slutfört</h2>
          <p className="mt-1 text-sm text-brand-800">Din tid är sparad och skickad till admin för granskning.</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Fact label="Incheckning" value={hhmm(fin.startedAt)} />
          <Fact label="Utcheckning" value={hhmm(fin.endedAt)} />
          <Fact label="Total tid" value={formatMinutes(fin.totalMinutes)} />
          <Fact label="Registrerade pauser" value={formatMinutes(fin.pausedMinutes)} />
          <div className="col-span-2 rounded-xl border border-brand-300 bg-white p-4 text-center">
            <dt className="text-xs text-ink-muted">Registrerad arbetstid</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{formatMinutes(fin.registeredMinutes)}</dd>
          </div>
          <Fact label="Status" value="Slutfört" />
          <Fact label="Godkännande" value={"status" in fin && fin.status !== "PRELIMINARY" ? "Godkänt" : "Väntar på admin"} />
        </dl>
        <p className="text-center text-xs text-ink-muted">GPS-spårningen är avslutad. Inga positioner sparas efter utcheckning.</p>
      </section>
    );
  }

  // C. Ej incheckad
  const st = state.availability.status;
  const gpsHint = <GpsHint check={check} areaConfigured={state.areaConfigured} />;
  if (st === "AVAILABLE") {
    return (
      <section aria-label="Klocka in" className="flex flex-col gap-4">
        <div className="rounded-2xl border-2 border-brand-300 bg-brand-50 p-5 text-center">
          <p className="text-sm font-semibold text-brand-900">Du kan klocka in nu</p>
          <div className="mt-2">{dayLine}</div>
        </div>
        {gpsHint}
        {error ? <ErrorBox message={error.message} /> : null}
        <button type="button" disabled={pending === "in" || !online} onClick={doClockIn} className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-700 text-xl font-semibold text-white shadow-card active:bg-brand-800 disabled:opacity-60">
          <Play className="size-6" aria-hidden /> {pending === "in" ? "Hämtar position…" : "Klocka in"}
        </button>
        {!online ? <p className="text-center text-sm text-orange-800">Ingen internetuppkoppling. Du kan inte klocka in just nu.</p> : null}
        <p className="text-center text-xs text-ink-muted">Din position kontrolleras bara när du klockar in och under passet.</p>
        {sim}
      </section>
    );
  }
  if (st === "TOO_EARLY") {
    const secs = Math.ceil(secondsUntilOpen);
    const mins = Math.ceil(secs / 60);
    return (
      <section aria-label="Incheckning öppnar snart" className="flex flex-col gap-4">
        <div className="rounded-2xl border-2 border-line bg-white p-5 text-center">
          <Clock className="mx-auto size-8 text-ink-muted" aria-hidden />
          <p className="mt-2 text-lg font-semibold">Incheckning öppnar om {secs >= 3600 ? `${Math.floor(secs / 3600)} h ${mins - Math.floor(secs / 3600) * 60} min` : `${mins} minuter`}</p>
          <p className="text-4xl font-semibold tabular-nums" role="timer">{formatHms(secs)}</p>
          <div className="mt-3 flex flex-col gap-1">{dayLine}</div>
          <p className="mt-2 text-sm text-ink-muted">Du kan inte klocka in förrän {state.settings.checkInMarginMinutes} minuter före stängning. Du arbetar tills alla bollar är plockade.</p>
        </div>
        {gpsHint}
        <button type="button" disabled className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-stone-300 text-xl font-semibold text-white" aria-disabled>
          <Play className="size-6" aria-hidden /> Klocka in
        </button>
        {sim}
      </section>
    );
  }
  const messages: Record<string, string> = {
    NO_SHIFT: "Du är inte schemalagd idag.",
    CLOSED_DAY: "Rangen är stängd idag.",
    CANCELLED: "Dagens pass är inställt.",
    NOT_PUBLISHED: "Dagens pass är inte publicerat än.",
    WINDOW_ENDED: "Arbetsdagen är över. Kontakta admin om du har arbetat.",
  };
  return (
    <section aria-label="Inget pass" className="flex flex-col gap-4">
      <div className="rounded-2xl border-2 border-line bg-white p-5 text-center">
        <MapPin className="mx-auto size-8 text-ink-muted" aria-hidden />
        <p className="mt-2 text-lg font-semibold">{messages[st] ?? "Inget pågående pass."}</p>
        {state.next ? (
          <p className="mt-2 text-sm text-ink-muted">Nästa arbetsdag: <b className="text-ink">{state.next.date}</b>, rangen stänger {state.next.closeTime?.replace(":", ".")}{state.next.earliestCheckIn ? `, incheckning från ${hhmm(state.next.earliestCheckIn)}` : ""}.</p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">Du har inga kommande arbetsdagar just nu.</p>
        )}
      </div>
      {sim}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="flex gap-2 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

/** Var befinner jag mig? Visas innan incheckning så att man förstår varför knappen eventuellt nekas. */
function GpsHint({ check, areaConfigured }: { check: PositionCheck | { ok: false; message: string } | null; areaConfigured: boolean }) {
  if (!areaConfigured) {
    return (
      <div className="flex gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> Arbetsområdet är inte inställt än. Kontakta admin, du kan inte klocka in förrän det är gjort.
      </div>
    );
  }
  if (!check) {
    return <p className="flex items-center justify-center gap-2 text-sm text-ink-muted"><Navigation className="size-4 animate-pulse" aria-hidden /> Hämtar din position…</p>;
  }
  if (!check.ok) {
    return (
      <div className="flex gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {check.message}
      </div>
    );
  }
  const ok = check.zone !== "OUTSIDE";
  return (
    <div className={cn("flex gap-2 rounded-xl border p-3 text-sm", ok ? "border-brand-300 bg-brand-50 text-brand-900" : "border-danger-200 bg-danger-50 text-danger-700")}>
      {ok ? <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <PauseCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>
        {check.zone === "INSIDE" ? "Du är inom arbetsområdet." : check.zone === "MARGIN" ? "Du är precis utanför gränsen men inom säkerhetsmarginalen. Det går att klocka in." : `Du är ${Math.round(check.distanceM)} m utanför arbetsområdet (marginal ${check.marginM} m). Gå till golfanläggningen för att klocka in.`}
        <span className="text-ink-muted"> GPS ±{Math.round(check.accuracyM)} m.</span>
      </span>
    </div>
  );
}

export { WifiOff };
