import { describe, expect, it } from "vitest";
import {
  type Ring,
  bufferRingPreview,
  classifyPosition,
  distanceOutsideMeters,
  haversineMeters,
  interiorPoint,
  offsetPoint,
  parseRings,
  pointInRing,
  pointOutside,
  ringSelfIntersects,
} from "@/modules/bollplockare/domain/geo";

// Fiktivt område, endast för test: en rektangel ca 400 m × 300 m (norr–söder 300 m, öst–väst 400 m).
const O: [number, number] = [59.0, 15.0];
const SW = O;
const NW = offsetPoint(SW, 300, 0);
const NE = offsetPoint(NW, 400, 90);
const SE = offsetPoint(NE, 300, 180);
const RECT: Ring = [SW, NW, NE, SE];
// Ett L-format (konkavt) område.
const L_SHAPE: Ring = [
  [59.0, 15.0],
  offsetPoint([59.0, 15.0], 200, 0),
  offsetPoint(offsetPoint([59.0, 15.0], 200, 0), 100, 90),
  offsetPoint(offsetPoint(offsetPoint([59.0, 15.0], 200, 0), 100, 90), 100, 180),
  offsetPoint(offsetPoint(offsetPoint(offsetPoint([59.0, 15.0], 200, 0), 100, 90), 100, 180), 200, 90),
  offsetPoint([59.0, 15.0], 200, 90),
].map((p) => p as [number, number]);

describe("avstånd och polygon", () => {
  it("haversine och offsetPoint stämmer med varandra (±1 %)", () => {
    for (const m of [10, 100, 1000]) expect(haversineMeters(O, offsetPoint(O, m, 37))).toBeCloseTo(m, -Math.log10(m) + 1.5);
    expect(Math.abs(haversineMeters(O, offsetPoint(O, 400, 90)) - 400)).toBeLessThan(4);
  });

  it("punkt i polygon, inklusive konkav polygon", () => {
    expect(pointInRing(interiorPoint([RECT]), RECT)).toBe(true);
    expect(pointInRing(offsetPoint(NE, 5, 45), RECT)).toBe(false);
    // L-formen saknar övre högra hörnet: en punkt där är utanför.
    expect(pointInRing(offsetPoint(O, 50, 90), L_SHAPE)).toBe(true);
    expect(pointInRing(offsetPoint(offsetPoint(O, 150, 0), 150, 90), L_SHAPE)).toBe(false);
  });

  it("avståndet mäts från ytterkanten, inte från mitten: lika långt från en kant är lika långt", () => {
    expect(distanceOutsideMeters(interiorPoint([RECT]), [RECT])).toBe(0);
    const east10 = offsetPoint(offsetPoint(SE, 150, 0), 10, 90); // 10 m öster om östra kanten, mitt på den
    const north10 = offsetPoint(offsetPoint(NW, 200, 90), 10, 0); // 10 m norr om norra kanten
    expect(distanceOutsideMeters(east10, [RECT])).toBeCloseTo(10, 0);
    expect(distanceOutsideMeters(north10, [RECT])).toBeCloseTo(10, 0);
    // Diagonalt från ett hörn: sqrt(30² + 40²) = 50 m
    const corner = offsetPoint(offsetPoint(NE, 30, 0), 40, 90);
    expect(distanceOutsideMeters(corner, [RECT])).toBeCloseTo(50, 0);
  });

  it("flera delområden: avståndet är till det närmaste", () => {
    const far = RECT.map((p) => offsetPoint(p, 2000, 90) as [number, number]);
    const p = offsetPoint(far[0], 30, 270); // 30 m väster om det andra området
    expect(distanceOutsideMeters(p, [RECT, far])).toBeCloseTo(30, 0);
    expect(distanceOutsideMeters(interiorPoint([far]), [RECT, far])).toBe(0);
  });
});

describe("zoner: inom området, säkerhetsmarginal, utanför", () => {
  const margin = 40;
  it("zon 1, 2 och 3 med marginalen mätt från gränsen", () => {
    expect(classifyPosition(interiorPoint([RECT]), [RECT], margin, 5).zone).toBe("INSIDE");
    expect(classifyPosition(offsetPoint(offsetPoint(SE, 150, 0), 25, 90), [RECT], margin, 5)).toMatchObject({ zone: "MARGIN", uncertain: false });
    const out = classifyPosition(offsetPoint(offsetPoint(SE, 150, 0), 54, 90), [RECT], margin, 5);
    expect(out.zone).toBe("OUTSIDE");
    expect(out.distanceM).toBeCloseTo(54, 0);
  });

  it("marginalen är konfigurerbar (30, 35, 40 m)", () => {
    const p = offsetPoint(offsetPoint(SE, 150, 0), 37, 90);
    expect(classifyPosition(p, [RECT], 40, 3).zone).toBe("MARGIN");
    expect(classifyPosition(p, [RECT], 35, 1).zone).toBe("OUTSIDE");
    expect(classifyPosition(p, [RECT], 30, 3).zone).toBe("OUTSIDE");
  });

  it("zon 3 kräver att hela mätfelet ryms utanför marginalen (annars marginalzon, osäker)", () => {
    const p = offsetPoint(offsetPoint(SE, 150, 0), 45, 90); // 45 m ut
    expect(classifyPosition(p, [RECT], 40, 3).zone).toBe("OUTSIDE"); // 45 − 3 > 40
    expect(classifyPosition(p, [RECT], 40, 8)).toMatchObject({ zone: "MARGIN", uncertain: true }); // 45 − 8 < 40
  });

  it("pointOutside hamnar verkligen utanför med rätt avstånd", () => {
    expect(classifyPosition(pointOutside([RECT], 80), [RECT], margin, 5).zone).toBe("OUTSIDE");
    expect(distanceOutsideMeters(pointOutside([RECT], 80), [RECT])).toBeGreaterThan(70);
  });
});

describe("parseRings", () => {
  const ok = RECT.map((p) => [...p]);
  it("godtar en giltig polygon och normaliserar den", () => {
    const r = parseRings([ok]);
    expect(r.ok).toBe(true);
  });

  it("avvisar fel format, för få hörn, ogiltiga koordinater, självkorsning, för stort och för litet", () => {
    expect(parseRings("x")).toMatchObject({ ok: false });
    expect(parseRings([])).toMatchObject({ ok: false });
    expect(parseRings([[[59, 15], [59.1, 15]]])).toMatchObject({ ok: false, message: expect.stringContaining("tre hörn") });
    expect(parseRings([[[59, 15], [59.1, 15], [95, 15]]])).toMatchObject({ ok: false, message: expect.stringContaining("ogiltig") });
    expect(parseRings([[[59, 15], [59.1, 15], ["a", 1]]])).toMatchObject({ ok: false });
    const bowtie = [[59.0, 15.0], [59.001, 15.001], [59.001, 15.0], [59.0, 15.001]];
    expect(ringSelfIntersects(bowtie as unknown as Ring)).toBe(true);
    expect(parseRings([bowtie])).toMatchObject({ ok: false, message: expect.stringContaining("korsar") });
    expect(parseRings([[[59, 15], [60, 15], [60, 16]]])).toMatchObject({ ok: false, message: expect.stringContaining("orimligt") });
    expect(parseRings([[[59, 15], [59.000001, 15], [59, 15.000001]]])).toMatchObject({ ok: false, message: expect.stringContaining("litet") });
    expect(parseRings([Array.from({ length: 501 }, (_, i) => [59 + i * 1e-6, 15 + (i % 2) * 1e-5])])).toMatchObject({ ok: false });
  });
});

describe("förhandsvisning av marginalen", () => {
  it("ringen ligger ca marginalen utanför varje kant och omsluter området", () => {
    const buffered = bufferRingPreview(RECT, 40);
    for (const p of RECT) expect(pointInRing(p, buffered)).toBe(true);
    const east = offsetPoint(offsetPoint(SE, 150, 0), 40, 90);
    // En punkt precis innanför bufferten (35 m ut) ligger inom, en 50 m ut ligger utanför.
    expect(pointInRing(offsetPoint(offsetPoint(SE, 150, 0), 35, 90), buffered)).toBe(true);
    expect(pointInRing(offsetPoint(offsetPoint(SE, 150, 0), 50, 90), buffered)).toBe(false);
    expect(Math.abs(distanceOutsideMeters(east, [RECT]) - 40)).toBeLessThan(1);
  });

  it("fungerar även för konkava områden och oavsett varv (medurs/moturs)", () => {
    const buffered = bufferRingPreview([...L_SHAPE].reverse(), 20);
    for (const p of L_SHAPE) expect(pointInRing(p, buffered)).toBe(true);
  });
});
