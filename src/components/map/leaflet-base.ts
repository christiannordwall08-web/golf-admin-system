import type * as Leaflet from "leaflet";

/**
 * Gemensam kartuppsättning (Leaflet + OpenStreetMap-brickor). Inga nycklar eller betaltjänster. Bricklagret (tile.openstreetmap.org)
 * är gratis men har en användningspolicy: det är avsett för måttlig användning (Admins karta). Byt `TILE_URL` mot en egen
 * eller betald bricktjänst om användningen växer, se docs/BOLLPLOCKARE-GPS.md.
 */
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>-bidragsgivare';
/** Standardvy när inget område finns: Sverige. */
export const DEFAULT_VIEW: [number, number] = [62.0, 15.0];

export const COLORS = { green: "#2e7d32", yellow: "#ca8a04", orange: "#ea580c", red: "#dc2626", gray: "#78716c", area: "#166534", margin: "#d97706" } as const;

export async function loadLeaflet(): Promise<typeof Leaflet> {
  await import("leaflet/dist/leaflet.css");
  return (await import("leaflet")).default ?? (await import("leaflet"));
}

export function createMap(L: typeof Leaflet, el: HTMLElement, center?: [number, number], zoom?: number): Leaflet.Map {
  const map = L.map(el, { center: center ?? DEFAULT_VIEW, zoom: zoom ?? (center ? 16 : 5), zoomControl: true });
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
  return map;
}
