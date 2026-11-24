import { describe, expect, it } from "vitest";
import { type Ring, interiorPoint, offsetPoint, pointOutside } from "@/modules/bollplockare/domain/geo";
import {
  INITIAL_TRACK_STATE,
  type PositionSample,
  type TrackConfig,
  type TrackState,
  displayGpsStatus,
  evaluateSample,
} from "@/modules/bollplockare/domain/tracking";

// Fiktivt testområde (400 × 300 m). Se bollplockare-geo.test.ts.
const SW: [number, number] = [59.0, 15.0];
const NW = offsetPoint(SW, 300, 0) as [number, number];
const NE = offsetPoint(NW, 400, 90) as [number, number];
const SE = offsetPoint(NE, 300, 180) as [number, number];
const RECT: Ring = [SW, NW, NE, SE];
const CFG: TrackConfig = { rings: [RECT], marginM: 40, verificationSeconds: 30, maxAccuracyM: 50, staleAfterSeconds: 120, returnHysteresisM: 10 };

const T0 = new Date("2026-11-24T19:45:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const inside = interiorPoint([RECT]);
const east = (m: number) => offsetPoint(offsetPoint(SE, 150, 0), m, 90) as [number, number];
const pos = (p: readonly [number, number], accuracyM = 8, fixAt: Date | null = null): PositionSample => ({ kind: "position", lat: p[0], lng: p[1], accuracyM, fixAt });

const start: TrackState = { ...INITIAL_TRACK_STATE };

/** Kör en serie mätningar (sekunder efter T0) och samlar alla åtgärder. */
function run(samples: [number, PositionSample][], from: TrackState = start, cfg = CFG) {
  let state = from;
  const actions: ReturnType<typeof evaluateSample>["actions"] = [];
  const statuses: string[] = [];
  for (const [s, sample] of samples) {
    const r = evaluateSample(state, sample, at(s), cfg);
    state = r.next;
    actions.push(...r.actions);
    statuses.push(state.gpsStatus);
  }
  return { state, actions, statuses };
}
const types = (a: { type: string }[]) => a.map((x) => x.type);

describe("zon 1 och 2: tiden fortsätter normalt", () => {
  it("inom området: status INSIDE, ingen åtgärd", () => {
    const r = run([[0, pos(inside)], [15, pos(inside)]]);
    expect(r.statuses).toEqual(["INSIDE", "INSIDE"]);
    expect(types(r.actions)).toEqual([]);
  });

  it("inom säkerhetsmarginalen (25 m utanför gränsen): MARGIN, aldrig verifiering eller paus, hur länge man än står där", () => {
    const r = run(Array.from({ length: 20 }, (_, i) => [i * 15, pos(east(25))] as [number, PositionSample]));
    expect(new Set(r.statuses)).toEqual(new Set(["MARGIN"]));
    expect(r.state.paused).toBe(false);
    expect(types(r.actions)).toEqual([]);
  });
});

describe("zon 3: bekräftad avvikelse pausar, men aldrig på en enda mätning", () => {
  it("första mätningen utanför ger bara VERIFYING, ingen paus", () => {
    const r = run([[0, pos(east(80))]]);
    expect(r.statuses).toEqual(["VERIFYING"]);
    expect(types(r.actions)).toEqual([]);
    expect(r.state.paused).toBe(false);
  });

  it("två mätningar men för kort tid (< 30 s): fortfarande ingen paus", () => {
    const r = run([[0, pos(east(80))], [10, pos(east(81))], [20, pos(east(82))]]);
    expect(r.state.paused).toBe(false);
    expect(r.statuses).toEqual(["VERIFYING", "VERIFYING", "VERIFYING"]);
  });

  it("flera pålitliga mätningar utanför i 30 s: pausen startar vid FÖRSTA mätningen utanför, med avstånd", () => {
    const r = run([[0, pos(east(54))], [15, pos(east(55))], [30, pos(east(56))]]);
    expect(r.statuses).toEqual(["VERIFYING", "VERIFYING", "OUTSIDE"]);
    const pause = r.actions.find((a) => a.type === "PAUSE_START");
    expect(pause).toMatchObject({ type: "PAUSE_START", at: at(0) });
    expect(pause && "distanceM" in pause ? Math.round(pause.distanceM) : null).toBe(56);
    expect(r.state.paused).toBe(true);
  });

  it("verifieringstiden är konfigurerbar", () => {
    const fast = run([[0, pos(east(80))], [5, pos(east(80))], [10, pos(east(80))]], start, { ...CFG, verificationSeconds: 10 });
    expect(fast.state.paused).toBe(true);
  });

  it("en tillfälligt felaktig mätning (hopp utanför) pausar aldrig, och en mätning inne återställer verifieringen", () => {
    const r = run([[0, pos(inside)], [15, pos(east(300), 8)], [30, pos(inside)], [45, pos(inside)]]);
    expect(r.state.paused).toBe(false);
    expect(types(r.actions)).not.toContain("PAUSE_START");
    expect(r.statuses.at(-1)).toBe("INSIDE");
  });

  it("verifieringen börjar om efter ett glapp längre än 'gammal position' (uppkopplingen försvann)", () => {
    const r = run([[0, pos(east(80))], [15, pos(east(80))], [400, pos(east(80))]]);
    expect(r.state.paused).toBe(false); // 400 s senare: ny verifiering, inte bekräftad av den gamla
    expect(r.statuses.at(-1)).toBe("VERIFYING");
  });

  it("nära marginalgränsen med mätfel: osäkert, aldrig bekräftat utanför", () => {
    // 45 m ut med 8 m noggrannhet: 45 − 8 < 40 ⇒ marginalzon, ingen avvikelse hur länge det än varar
    const r = run(Array.from({ length: 10 }, (_, i) => [i * 15, pos(east(45), 8)] as [number, PositionSample]));
    expect(r.state.paused).toBe(false);
    expect(new Set(r.statuses)).toEqual(new Set(["MARGIN"]));
  });
});

describe("osäker och saknad GPS är aldrig en avvikelse", () => {
  it("dålig noggrannhet: UNRELIABLE, påverkar inte verifiering och sparar ingen ny position", () => {
    const r = run([[0, pos(inside)], [15, pos(east(500), 200)]]);
    expect(r.statuses).toEqual(["INSIDE", "UNRELIABLE"]);
    expect(r.state.lastLat).toBe(inside[0]); // senast verifierade är oförändrad
    expect(r.state.paused).toBe(false);
  });

  it("gammal mätning (klientens tidsstämpel > 120 s gammal) räknas som osäker", () => {
    const r = run([[0, pos(inside)], [15, pos(east(300), 8, at(-300))]]);
    expect(r.statuses.at(-1)).toBe("UNRELIABLE");
    expect(r.state.paused).toBe(false);
  });

  it("klientens klocka kan inte göra en mätning 'nyare' än serverns: framtida tidsstämpel ignoreras", () => {
    const r = run([[0, pos(east(80), 8, at(3600))]]);
    expect(r.statuses[0]).toBe("VERIFYING"); // behandlas som mottagen nu, inte som framtida
  });

  it("omöjligt hopp (fysiskt omöjlig hastighet) förkastas som mätfel", () => {
    const r = run([[0, pos(inside)], [5, pos(east(2000), 5)]]);
    expect(r.statuses.at(-1)).toBe("UNRELIABLE");
    expect(r.state.paused).toBe(false);
    expect(r.actions.find((a) => a.type === "EVENT")).toMatchObject({ event: "GPS_UNRELIABLE", reason: "JUMP" });
  });

  it("ogiltiga värden förkastas", () => {
    for (const bad of [pos([95, 10]), pos(inside, Number.NaN), pos(inside, -3)]) {
      expect(run([[0, bad]]).statuses[0]).toBe("UNRELIABLE");
    }
  });

  it("GPS saknas eller nekad: status ändras, men tid, pausstatus och verifiering rörs inte", () => {
    const verifying = run([[0, pos(east(80))]]).state;
    const lost = run([[20, { kind: "problem", problem: "UNAVAILABLE" }]], verifying);
    expect(lost.statuses).toEqual(["MISSING"]);
    expect(lost.state.paused).toBe(false);
    expect(lost.state.trackSamples).toBe(1);
    const denied = run([[20, { kind: "problem", problem: "DENIED" }]], verifying);
    expect(denied.statuses).toEqual(["DENIED"]);
    expect(denied.actions).toEqual([{ type: "EVENT", event: "GPS_DENIED", reason: undefined }]);
  });

  it("samma problem loggas bara en gång (inga upprepade larm), och återhämtning loggas", () => {
    const r = run([
      [0, pos(inside)],
      [15, { kind: "problem", problem: "TIMEOUT" }],
      [30, { kind: "problem", problem: "TIMEOUT" }],
      [45, pos(inside)],
    ]);
    expect(r.actions.map((a) => (a.type === "EVENT" ? a.event : a.type))).toEqual(["GPS_MISSING", "GPS_RESTORED"]);
  });

  it("signalen försvinner mitt i en paus: pausen ligger kvar tills återkomst är bekräftad", () => {
    const paused = run([[0, pos(east(80))], [15, pos(east(80))], [30, pos(east(80))]]).state;
    expect(paused.paused).toBe(true);
    const r = run([[60, { kind: "problem", problem: "UNAVAILABLE" }], [90, pos(east(500), 300)]], paused);
    expect(r.state.paused).toBe(true);
    expect(types(r.actions)).not.toContain("RESUME");
  });
});

describe("återupptagning", () => {
  const paused = run([[0, pos(east(80))], [15, pos(east(80))], [30, pos(east(80))]]).state;

  it("återupptas efter två pålitliga mätningar tillbaka, med tiden för FÖRSTA mätningen tillbaka", () => {
    const r = run([[100, pos(inside)], [115, pos(inside)]], paused);
    expect(r.actions.find((a) => a.type === "RESUME")).toEqual({ type: "RESUME", at: at(100) });
    expect(r.state.paused).toBe(false);
    expect(r.statuses.at(-1)).toBe("INSIDE");
  });

  it("en enda mätning tillbaka räcker inte", () => {
    const r = run([[100, pos(inside)]], paused);
    expect(r.state.paused).toBe(true);
  });

  it("hysteres: precis innanför marginalgränsen (35 m) återupptar inte, 25 m gör det", () => {
    const edge = run([[100, pos(east(35))], [115, pos(east(35))], [130, pos(east(35))]], paused);
    expect(edge.state.paused).toBe(true);
    const back = run([[100, pos(east(25))], [115, pos(east(25))]], paused);
    expect(back.state.paused).toBe(false);
  });

  it("inget fladder vid gränsen: växlar man mellan 45 m och 38 m blir det aldrig upprepade pauser/återupptagningar", () => {
    const flapping: [number, PositionSample][] = Array.from({ length: 40 }, (_, i) => [i * 15, pos(east(i % 2 ? 38 : 45), 3)]);
    const r = run(flapping);
    expect(types(r.actions).filter((t) => t === "PAUSE_START").length).toBeLessThanOrEqual(1);
    expect(types(r.actions).filter((t) => t === "RESUME").length).toBe(0);
  });

  it("avbruten återkomst (går ut igen) börjar om", () => {
    const r = run([[100, pos(inside)], [115, pos(east(80))], [130, pos(inside)]], paused);
    expect(r.state.paused).toBe(true);
  });
});

describe("visad status: gammal position visas aldrig som aktuell", () => {
  const now = at(1000);
  it("färsk status visas som den är", () => {
    expect(displayGpsStatus("INSIDE", at(950), at(950), now, 120)).toBe("INSIDE");
  });
  it("ingen uppdatering på över 120 s ⇒ STALE (positionen inte uppdaterad nyligen)", () => {
    expect(displayGpsStatus("INSIDE", at(700), at(700), now, 120)).toBe("STALE");
    expect(displayGpsStatus("MARGIN", null, at(700), now, 120)).toBe("STALE");
  });
  it("ingen kontakt alls än: NONE", () => {
    expect(displayGpsStatus("NONE", null, null, now, 120)).toBe("NONE");
  });
});

it("pointOutside används för testerna: ligger utanför marginalen", () => {
  expect(pointOutside([RECT], 100)[1]).toBeGreaterThan(NE[1]);
});
