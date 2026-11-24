/**
 * Geografi för arbetsområdet: polygoner, avstånd till gränsen och zonindelning.
 * Alla funktioner är rena och testade i tests/unit/bollplockare-geo.test.ts.
 *
 * Koordinater är [lat, lng] i grader (WGS84). Över några kilometer räcker en lokal plan projektion
 * (ekvirektangulär, meter) med fel långt under en procent, långt mindre än GPS-noggrannheten.
 */

export type Pt = readonly [lat: number, lng: number];
export type Ring = Pt[];

export const MAX_RINGS = 20;
export const MAX_POINTS_PER_RING = 500;
/** Ett område större än så (längs någon sida) är nästan säkert ett klickfel. */
export const MAX_EXTENT_METERS = 20_000;
export const MIN_AREA_SQUARE_METERS = 100;

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_EQUATOR = 111_320;
const EARTH_RADIUS_M = 6_371_008.8;

/** Rimlig latitud/longitud. */
export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Storcirkelavstånd i meter. */
export function haversineMeters(a: Pt, b: Pt): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

type XY = { x: number; y: number };

function projector(originLat: number, originLng: number) {
  const kx = M_PER_DEG_LNG_EQUATOR * Math.cos((originLat * Math.PI) / 180);
  return (p: Pt): XY => ({ x: (p[1] - originLng) * kx, y: (p[0] - originLat) * M_PER_DEG_LAT });
}

function ringArea(xy: XY[]): number {
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function segmentsIntersect(p1: XY, p2: XY, p3: XY, p4: XY): boolean {
  const d = (a: XY, b: XY, c: XY) => (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Korsar ringen sig själv? (O(n²), n ≤ 500.) Intilliggande kanter jämförs inte. */
export function ringSelfIntersects(ring: Ring): boolean {
  const proj = projector(ring[0][0], ring[0][1]);
  const xy = ring.map(proj);
  const n = xy.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsIntersect(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Validerar och normaliserar ringar från indata/databas. Kräver 3+ giltiga punkter per ring, ingen
 * självkorsning, rimlig storlek och yta. Returnerar svenska felmeddelanden.
 */
export function parseRings(input: unknown): { ok: true; rings: Ring[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) return { ok: false, message: "Området har fel format." };
  if (input.length === 0) return { ok: false, message: "Rita minst ett område." };
  if (input.length > MAX_RINGS) return { ok: false, message: `Högst ${MAX_RINGS} delområden.` };
  const rings: Ring[] = [];
  for (const [i, raw] of input.entries()) {
    const label = input.length > 1 ? `Delområde ${i + 1}` : "Området";
    if (!Array.isArray(raw) || raw.length < 3) return { ok: false, message: `${label} måste ha minst tre hörn.` };
    if (raw.length > MAX_POINTS_PER_RING) return { ok: false, message: `${label} har för många hörn (högst ${MAX_POINTS_PER_RING}).` };
    const ring: Ring = [];
    for (const p of raw) {
      if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || !isValidLatLng(p[0], p[1])) {
        return { ok: false, message: `${label} har en ogiltig koordinat.` };
      }
      ring.push([p[0], p[1]]);
    }
    const proj = projector(ring[0][0], ring[0][1]);
    const xy = ring.map(proj);
    const xs = xy.map((p) => p.x);
    const ys = xy.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) > MAX_EXTENT_METERS || Math.max(...ys) - Math.min(...ys) > MAX_EXTENT_METERS) {
      return { ok: false, message: `${label} är orimligt stort (över ${MAX_EXTENT_METERS / 1000} km). Kontrollera hörnen.` };
    }
    if (ringSelfIntersects(ring)) return { ok: false, message: `${label} korsar sig självt. Flytta hörnen så att linjerna inte korsar varandra.` };
    if (Math.abs(ringArea(xy)) < MIN_AREA_SQUARE_METERS) return { ok: false, message: `${label} är för litet eller helt platt.` };
    rings.push(ring);
  }
  return { ok: true, rings };
}

/** Punkt i polygon (strålmetoden). */
export function pointInRing(p: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Avstånd i meter från punkten till områdets YTTERGRÄNS (närmaste kant i någon ring). 0 om punkten ligger inom området.
 * Avståndet mäts alltid från den verkliga gränsen, aldrig från en mittpunkt.
 */
export function distanceOutsideMeters(p: Pt, rings: readonly Ring[]): number {
  if (rings.some((r) => pointInRing(p, r))) return 0;
  const proj = projector(p[0], p[1]);
  const origin: XY = { x: 0, y: 0 };
  let best = Infinity;
  for (const ring of rings) {
    const xy = ring.map(proj);
    for (let i = 0; i < xy.length; i++) best = Math.min(best, pointSegmentDistance(origin, xy[i], xy[(i + 1) % xy.length]));
  }
  return best;
}

export type Zone = "INSIDE" | "MARGIN" | "OUTSIDE";

export type Classification = {
  zone: Zone;
  /** Meter utanför gränsen (0 inom området). */
  distanceM: number;
  /** true = avståndet ligger inom mätfelet (noggrannheten) från marginalgränsen, så "utanför" är inte bekräftat. */
  uncertain: boolean;
};

/**
 * Zon 1 (INSIDE): inom gränsen. Zon 2 (MARGIN): utanför gränsen men inom säkerhetsmarginalen. Zon 3 (OUTSIDE): utanför marginalen.
 * Zon 3 gäller BARA om hela mätfelet ryms utanför marginalen (avstånd − noggrannhet > marginal). Ligger positionen så nära
 * marginalgränsen att felet kan vara orsaken räknas den som marginalzon, så ett GPS-fel ger aldrig en avvikelse.
 */
export function classifyPosition(p: Pt, rings: readonly Ring[], marginM: number, accuracyM: number): Classification {
  const d = distanceOutsideMeters(p, rings);
  if (d === 0) return { zone: "INSIDE", distanceM: 0, uncertain: false };
  if (d - Math.max(0, accuracyM) > marginM) return { zone: "OUTSIDE", distanceM: d, uncertain: false };
  return { zone: "MARGIN", distanceM: d, uncertain: d > marginM };
}

/** En punkt som med säkerhet ligger inom området (för test och simulering). Ringens "visuella mitt" hittas genom rastersökning. */
export function interiorPoint(rings: readonly Ring[]): Pt {
  const ring = rings[0];
  const lats = ring.map((p) => p[0]);
  const lngs = ring.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  let best: Pt = ring[0];
  let bestD = -1;
  const N = 24;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p: Pt = [minLat + ((maxLat - minLat) * i) / N, minLng + ((maxLng - minLng) * j) / N];
      if (!pointInRing(p, ring)) continue;
      const proj = projector(p[0], p[1]);
      const xy = ring.map(proj);
      let edge = Infinity;
      for (let k = 0; k < xy.length; k++) edge = Math.min(edge, pointSegmentDistance({ x: 0, y: 0 }, xy[k], xy[(k + 1) % xy.length]));
      if (edge > bestD) {
        bestD = edge;
        best = p;
      }
    }
  }
  return best;
}

/** Flytta en punkt `meters` meter i riktning `bearingDeg` (0 = norr, 90 = öster). */
export function offsetPoint(p: Pt, meters: number, bearingDeg: number): Pt {
  const rad = (bearingDeg * Math.PI) / 180;
  const dy = Math.cos(rad) * meters;
  const dx = Math.sin(rad) * meters;
  return [p[0] + dy / M_PER_DEG_LAT, p[1] + dx / (M_PER_DEG_LNG_EQUATOR * Math.cos((p[0] * Math.PI) / 180))];
}

/**
 * Punkt `meters` meter utanför områdets gräns (närmast en given punkt på kanten), för test och simulering.
 * Går rakt österut från kantpunkten och kontrollerar att resultatet verkligen hamnar utanför.
 */
export function pointOutside(rings: readonly Ring[], meters: number): Pt {
  const all = rings.flat();
  const east = all.reduce((best, p) => (p[1] > best[1] ? p : best), all[0]);
  return offsetPoint(east, meters, 90);
}

/**
 * Förhandsvisning av säkerhetsmarginalen: ringen utvidgad `meters` meter med rundade hörn. Endast för att RITA marginalen
 * på kartan. Själva avståndskontrollen (distanceOutsideMeters) är exakt och använder aldrig denna förenkling.
 */
export function bufferRingPreview(ring: Ring, meters: number, arcSteps = 8): Ring {
  const proj = projector(ring[0][0], ring[0][1]);
  const xy = ring.map(proj);
  const ccw = ringArea(xy) > 0;
  const pts = ccw ? xy : [...xy].reverse();
  const n = pts.length;
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    // Utåtriktad normal för kanterna prev→cur och cur→next (för en moturs ring ligger utsidan till höger).
    const n1 = norm(cur.y - prev.y, -(cur.x - prev.x));
    const n2 = norm(next.y - cur.y, -(next.x - cur.x));
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (cross > 0) {
      // Konkavt hörn: skärningspunkt (miter) räcker och undviker snurror.
      const bx = n1.x + n2.x;
      const by = n1.y + n2.y;
      const bl = Math.hypot(bx, by) || 1;
      const cos = (n1.x * n2.x + n1.y * n2.y + 1) / 2;
      const scale = meters / Math.sqrt(Math.max(cos, 0.05));
      out.push({ x: cur.x + (bx / bl) * scale, y: cur.y + (by / bl) * scale });
    } else {
      // Konvext hörn: rund båge mellan de två normalerna.
      const a1 = Math.atan2(n1.y, n1.x);
      let a2 = Math.atan2(n2.y, n2.x);
      while (a2 > a1) a2 -= 2 * Math.PI;
      for (let s = 0; s <= arcSteps; s++) {
        const a = a1 + ((a2 - a1) * s) / arcSteps;
        out.push({ x: cur.x + Math.cos(a) * meters, y: cur.y + Math.sin(a) * meters });
      }
    }
  }
  const [originLat, originLng] = ring[0];
  const kx = M_PER_DEG_LNG_EQUATOR * Math.cos((originLat * Math.PI) / 180);
  return out.map((p) => [originLat + p.y / M_PER_DEG_LAT, originLng + p.x / kx] as Pt);
}

function norm(x: number, y: number): XY {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}
