"use client";

import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import { type Ring, bufferRingPreview } from "@/modules/bollplockare/domain/geo";
import { COLORS, createMap, loadLeaflet } from "./leaflet-base";

export type LiveMarker = {
  id: string;
  name: string;
  tone: "green" | "yellow" | "orange" | "red" | "gray";
  lat: number;
  lng: number;
  /** Positionen är för gammal för att vara en aktuell liveposition. Ritas ljus och märks "senast verifierad". */
  stale: boolean;
  lines: string[];
  href: string;
};

/**
 * Karta för Admin: arbetsområdet, dess yttergräns, säkerhetsmarginalen och aktiva bollplockare.
 * Positioner finns bara under ett pågående pass. Gamla positioner visas aldrig som aktuella (ljus markering med tid).
 * Texter byggs som DOM-noder (textContent), aldrig som HTML, så att namn aldrig kan injicera kod.
 */
export function LiveMap({ rings, marginMeters, markers }: { rings: Ring[]; marginMeters: number; markers: LiveMarker[] }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L;
      mapRef.current = createMap(L, el.current);
      layerRef.current = L.layerGroup().addTo(mapRef.current);
      draw();
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      fitted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const bounds: Leaflet.LatLngExpression[] = [];
    for (const ring of rings) {
      const ll = ring.map((p) => [p[0], p[1]] as [number, number]);
      L.polygon(bufferRingPreview(ring, marginMeters).map((p) => [p[0], p[1]] as [number, number]), { color: COLORS.margin, weight: 1, dashArray: "6 6", fillColor: COLORS.margin, fillOpacity: 0.08 }).addTo(layer).bindTooltip(`Säkerhetsmarginal ${marginMeters} m`, { sticky: true });
      L.polygon(ll, { color: COLORS.area, weight: 2, fillColor: COLORS.area, fillOpacity: 0.12 }).addTo(layer).bindTooltip("Godkänt arbetsområde", { sticky: true });
      bounds.push(...ll);
    }
    for (const m of markers) {
      const color = COLORS[m.tone];
      const dot = L.circleMarker([m.lat, m.lng], { radius: 11, color: m.stale ? "#a8a29e" : "#ffffff", weight: 3, fillColor: color, fillOpacity: m.stale ? 0.35 : 0.95, dashArray: m.stale ? "3 3" : undefined }).addTo(layer);
      const tip = document.createElement("span");
      tip.textContent = m.stale ? `${m.name} (gammal position)` : m.name;
      dot.bindTooltip(tip, { permanent: true, direction: "top", offset: [0, -10] });
      const pop = document.createElement("div");
      const h = document.createElement("strong");
      h.textContent = m.name;
      pop.append(h);
      for (const line of m.lines) {
        const p = document.createElement("div");
        p.textContent = line;
        pop.append(p);
      }
      const a = document.createElement("a");
      a.href = m.href;
      a.textContent = "Öppna arbetspasset";
      a.style.color = "#166534";
      pop.append(a);
      dot.bindPopup(pop);
      bounds.push([m.lat, m.lng]);
    }
    if (!fitted.current && bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 18 });
      fitted.current = true;
    }
  }

  useEffect(draw, [rings, marginMeters, markers]);

  return <div ref={el} className="h-[420px] w-full rounded-card border border-line" role="region" aria-label="Karta över arbetsområdet och aktiva bollplockare" />;
}
