import "server-only";
import { isDevPreviewEnabled } from "@/server/dev-preview";
import type { DbClient } from "@/server/db-client";
import { interiorPoint, pointOutside } from "../domain/geo";
import { getWorkArea } from "./settings";

/**
 * Punkter för GPS-simuleringen, avledda från det inställda arbetsområdet. Returnerar ALLTID null utanför lokalt
 * förhandsvisningsläge (DEV_PREVIEW + development + lokal databas), så att simuleringen aldrig kan nå vanliga användare.
 */
export type SimulationPoints = { inside: [number, number]; margin: [number, number]; outside: [number, number]; far: [number, number] };

export async function getSimulationPoints(db: DbClient): Promise<SimulationPoints | null> {
  if (!isDevPreviewEnabled()) return null;
  const area = await getWorkArea(db);
  if (!area.configured) return null;
  const pair = (p: readonly [number, number]): [number, number] => [p[0], p[1]];
  return {
    inside: pair(interiorPoint(area.rings)),
    margin: pair(pointOutside(area.rings, Math.max(5, area.marginMeters / 2))),
    outside: pair(pointOutside(area.rings, area.marginMeters + 60)),
    far: pair(pointOutside(area.rings, 3000)),
  };
}
