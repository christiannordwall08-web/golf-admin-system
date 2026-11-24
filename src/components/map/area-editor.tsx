"use client";

import type * as Leaflet from "leaflet";
import { Crosshair, Eraser, FlaskConical, LocateFixed, MousePointerClick, Plus, Save, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Ring, bufferRingPreview, classifyPosition, parseRings } from "@/modules/bollplockare/domain/geo";
import { saveWorkAreaAction } from "@/app/admin/bollplockare/actions";
import { COLORS, createMap, loadLeaflet } from "./leaflet-base";

type Mode = "draw" | "test";

/**
 * Admins kartverktyg för arbetsområdet: rita polygonen genom att klicka på kartan, flytta hörn genom att dra dem,
 * ta bort ett hörn genom att dubbelklicka på det, lägg till flera delområden (t.ex. rangen och parkeringen) och se
 * säkerhetsmarginalen utritad. "Testa position" visar vilken zon en punkt på kartan hamnar i (samma beräkning som servern använder).
 * Sparas först när Admin trycker Spara. Servern validerar allt igen.
 */
export function AreaEditor({ initialRings, initialMargin, version }: { initialRings: Ring[]; initialMargin: number; version: number }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const ringsRef = useRef<[number, number][][]>(initialRings.map((r) => r.map((p) => [p[0], p[1]] as [number, number])));
  const testRef = useRef<{ lat: number; lng: number } | null>(null);
  const [active, setActive] = useState(Math.max(0, initialRings.length - 1));
  const [margin, setMargin] = useState(initialMargin);
  const [mode, setMode] = useState<Mode>("draw");
  const [info, setInfo] = useState<{ tone: "success" | "danger" | "info" | "warning"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(version);
  const [counts, setCounts] = useState(ringsRef.current.map((r) => r.length));
  const stateRef = useRef({ active, margin, mode });
  stateRef.current = { active, margin, mode };

  function refreshCounts() {
    setCounts(ringsRef.current.map((r) => r.length));
  }

  function redraw() {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    const { active: act, margin: m } = stateRef.current;
    ringsRef.current.forEach((ring, ri) => {
      if (ring.length >= 3) {
        L.polygon(bufferRingPreview(ring as Ring, m).map((p) => [p[0], p[1]] as [number, number]), { color: COLORS.margin, weight: 1, dashArray: "6 6", fillColor: COLORS.margin, fillOpacity: 0.08, interactive: false }).addTo(layer);
      }
      const shape = ring.length >= 3
        ? L.polygon(ring, { color: ri === act ? "#166534" : "#4d7c0f", weight: ri === act ? 3 : 2, fillColor: COLORS.area, fillOpacity: 0.15, interactive: false }).addTo(layer)
        : L.polyline(ring, { color: "#166534", weight: 3, interactive: false }).addTo(layer);
      ring.forEach((pt, pi) => {
        const icon = L.divIcon({ className: "", html: `<div style="width:16px;height:16px;border-radius:50%;background:${ri === act ? "#166534" : "#4d7c0f"};border:3px solid #fff;box-shadow:0 0 0 1px #166534;cursor:grab"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
        const mk = L.marker(pt, { draggable: true, icon, title: "Dra för att flytta, dubbelklicka för att ta bort" }).addTo(layer);
        mk.on("drag", () => {
          const ll = mk.getLatLng();
          ring[pi] = [ll.lat, ll.lng];
          shape.setLatLngs(ring);
        });
        mk.on("dragend", () => redraw());
        mk.on("dblclick", (e) => {
          L.DomEvent.stopPropagation(e);
          ring.splice(pi, 1);
          if (ring.length === 0) {
            ringsRef.current.splice(ri, 1);
            setActive(Math.max(0, ringsRef.current.length - 1));
          }
          refreshCounts();
          redraw();
        });
      });
    });
    const t = testRef.current;
    if (t) L.circleMarker([t.lat, t.lng], { radius: 8, color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 1, weight: 3 }).addTo(layer);
  }

  useEffect(() => {
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L;
      const all = ringsRef.current.flat();
      const map = createMap(L, el.current);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 18 });
      map.doubleClickZoom.disable();
      map.on("click", (e: Leaflet.LeafletMouseEvent) => {
        const { active: act, mode: md, margin: m } = stateRef.current;
        if (md === "test") {
          testRef.current = { lat: e.latlng.lat, lng: e.latlng.lng };
          const rings = ringsRef.current.filter((r) => r.length >= 3) as Ring[];
          if (rings.length === 0) setInfo({ tone: "warning", text: "Rita först ett område att testa mot." });
          else {
            const c = classifyPosition([e.latlng.lat, e.latlng.lng], rings, m, 0);
            setInfo({ tone: c.zone === "OUTSIDE" ? "danger" : "success", text: c.zone === "INSIDE" ? "Zon 1: inom godkänt arbetsområde." : c.zone === "MARGIN" ? `Zon 2: ${Math.round(c.distanceM)} m utanför gränsen, inom säkerhetsmarginalen (${m} m). Tiden fortsätter normalt.` : `Zon 3: ${Math.round(c.distanceM)} m utanför gränsen, utanför marginalen (${m} m). Här pausas tiden efter verifiering.` });
          }
          redraw();
          return;
        }
        if (ringsRef.current.length === 0) ringsRef.current.push([]);
        const ring = ringsRef.current[Math.min(act, ringsRef.current.length - 1)];
        ring.push([e.latlng.lat, e.latlng.lng]);
        refreshCounts();
        redraw();
      });
      redraw();
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw läser aktuellt läge via refs
  useEffect(redraw, [margin, active]);

  function addRing() {
    ringsRef.current.push([]);
    setActive(ringsRef.current.length - 1);
    setMode("draw");
    refreshCounts();
    redraw();
  }
  function undo() {
    const ring = ringsRef.current[active];
    if (!ring) return;
    ring.pop();
    if (ring.length === 0 && ringsRef.current.length > 1) {
      ringsRef.current.splice(active, 1);
      setActive(Math.max(0, ringsRef.current.length - 1));
    }
    refreshCounts();
    redraw();
  }
  function clearAll() {
    if (!window.confirm("Ta bort hela det ritade området? Det sparade området ändras först när du trycker Spara.")) return;
    ringsRef.current = [];
    setActive(0);
    refreshCounts();
    redraw();
  }
  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) => mapRef.current?.setView([p.coords.latitude, p.coords.longitude], 17),
      () => setInfo({ tone: "warning", text: "Kunde inte hämta din position. Zooma in på golfanläggningen manuellt." }),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }
  async function save() {
    const polygons = ringsRef.current.filter((r) => r.length > 0);
    const check = parseRings(polygons);
    if (!check.ok) return setInfo({ tone: "danger", text: check.message });
    setSaving(true);
    const r = await saveWorkAreaAction({ polygons, marginMeters: margin, expectedVersion: currentVersion });
    setSaving(false);
    if (r.ok) {
      setCurrentVersion(r.version);
      setInfo({ tone: "success", text: "Arbetsområdet är sparat. Det gäller direkt för alla incheckningar och positionskontroller." });
    } else setInfo({ tone: "danger", text: r.message });
  }

  const tab = (m: Mode, label: string, Icon: typeof Crosshair) => (
    <button type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium", mode === m ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white hover:bg-brand-50")}>
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {tab("draw", "Rita och flytta", MousePointerClick)}
        {tab("test", "Testa position", FlaskConical)}
        <Button variant="secondary" size="sm" onClick={addRing}><Plus className="size-4" aria-hidden /> Nytt delområde</Button>
        <Button variant="secondary" size="sm" onClick={undo}><Undo2 className="size-4" aria-hidden /> Ångra punkt</Button>
        <Button variant="ghost" size="sm" onClick={clearAll}><Eraser className="size-4" aria-hidden /> Rensa</Button>
        <Button variant="ghost" size="sm" onClick={locate}><LocateFixed className="size-4" aria-hidden /> Min position</Button>
      </div>
      <div ref={el} className="h-[520px] w-full rounded-card border border-line" role="application" aria-label="Karta för att rita arbetsområdet" />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Säkerhetsmarginal (meter)</span>
            <input type="number" min={0} max={500} step={1} value={margin} onChange={(e) => setMargin(Math.max(0, Math.min(500, Math.round(Number(e.target.value) || 0))))} className="h-10 w-28 rounded-lg border border-line bg-white px-3 text-base" />
          </label>
          <p className="max-w-md text-xs text-ink-muted">Extra marginal utanför hela områdets yttergräns (standard 40 m). Tiden pausas först utanför marginalen. Den streckade gula ytan visar marginalen.</p>
        </div>
        <Button onClick={save} disabled={saving} size="lg"><Save className="size-4" aria-hidden /> {saving ? "Sparar…" : "Spara arbetsområdet"}</Button>
      </div>
      <p className="text-xs text-ink-muted" aria-live="polite">
        {counts.length === 0 ? "Klicka på kartan för att sätta det första hörnet." : counts.map((c, i) => `Delområde ${i + 1}: ${c} hörn${i === active ? " (aktivt)" : ""}`).join(" · ")}
        {counts.length > 1 ? <span> · <label>Aktivt: <select value={active} onChange={(e) => setActive(Number(e.target.value))} className="rounded border border-line bg-white">{counts.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label></span> : null}
      </p>
      {info ? <Notice tone={info.tone}>{info.text}</Notice> : null}
    </div>
  );
}
