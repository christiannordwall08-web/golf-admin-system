import "server-only";
import { isDevPreviewEnabled } from "@/server/dev-preview";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { type Pt, interiorPoint, offsetPoint, pointOutside } from "../domain/geo";
import { getWorkArea, saveWorkArea } from "./settings";

/**
 * Skapar ett FIKTIVT testområde (400 × 300 m, 40 m marginal) om inget område finns. Bara i lokalt förhandsvisningsläge:
 * utanför det görs ingenting. Skriver aldrig över ett område som redan är inställt. Returnerar true om det skapades.
 */
export async function ensureTestWorkArea(db: PrismaClient, actor: { id: string }): Promise<boolean> {
  if (!isDevPreviewEnabled()) return false;
  if ((await getWorkArea(db)).configured) return false;
  const sw: Pt = [59.3293, 18.0686];
  const nw = offsetPoint(sw, 300, 0);
  const ne = offsetPoint(nw, 400, 90);
  const se = offsetPoint(ne, 300, 180);
  await saveWorkArea(db, { id: actor.id, role: "ADMIN" }, { polygons: [[sw, nw, ne, se].map((x) => [x[0], x[1]])], marginMeters: 40, expectedVersion: 0 });
  return true;
}

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
