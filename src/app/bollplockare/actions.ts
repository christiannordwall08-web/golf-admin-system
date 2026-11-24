"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { classifyPosition } from "@/modules/bollplockare/domain/geo";
import type { PositionSample } from "@/modules/bollplockare/domain/tracking";
import { clockIn, clockOut, reportPosition } from "@/modules/bollplockare/server/clock";
import { type PanelSnapshot, toSnapshot } from "@/modules/bollplockare/server/panel";
import { getSettings, getWorkArea } from "@/modules/bollplockare/server/settings";
import { requirePermission, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError, UnauthenticatedError } from "@/server/errors";
import { approveMyShift } from "@/server/services/shift-response";
import { redirect } from "next/navigation";

/**
 * Server Actions för bollplockarens klocka. Varje anrop hämtar användaren och kontrollerar behörighet på servern;
 * klienten kan bara skicka en mätning. Tiden sätts alltid av servern (klientens `fixAtMs` används bara för att se om en mätning är gammal).
 */
const sampleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("position"),
    lat: z.number().finite(),
    lng: z.number().finite(),
    accuracyM: z.number().finite().min(0).max(100_000),
    fixAtMs: z.number().finite().nullable().optional(),
  }),
  z.object({ kind: z.literal("problem"), problem: z.enum(["DENIED", "UNAVAILABLE", "TIMEOUT"]) }),
]);
export type SampleInput = z.input<typeof sampleSchema>;

function toSample(input: unknown): PositionSample | null {
  const p = sampleSchema.safeParse(input);
  if (!p.success) return null;
  return p.data.kind === "position"
    ? { kind: "position", lat: p.data.lat, lng: p.data.lng, accuracyM: p.data.accuracyM, fixAt: p.data.fixAtMs ? new Date(p.data.fixAtMs) : null }
    : { kind: "problem", problem: p.data.problem };
}

export type ClockActionResult =
  | { ok: true; snapshot?: PanelSnapshot; finished?: { totalMinutes: number; pausedMinutes: number; registeredMinutes: number; startedAt: string; endedAt: string } }
  | { ok: false; code: string; message: string; secondsUntil?: number };

async function session() {
  try {
    const s = await requirePermission("worktime:clock");
    // Klockan hör till anställdinloggningen, aldrig adminsessionen.
    if (s.context !== "EMPLOYEE") throw new UnauthenticatedError();
    return s;
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    throw e;
  }
}

const bad: ClockActionResult = { ok: false, code: "INVALID", message: "Ogiltig position. Försök igen." };

export async function clockInAction(input: SampleInput): Promise<ClockActionResult> {
  const s = await session();
  const sample = toSample(input);
  if (!sample) return bad;
  try {
    const r = await clockIn(getDb(), toActor(s), { sample });
    revalidatePath("/bollplockare");
    return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message, secondsUntil: r.secondsUntil };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

export async function reportPositionAction(input: SampleInput): Promise<ClockActionResult> {
  const s = await session();
  const sample = toSample(input);
  if (!sample) return bad;
  try {
    const r = await reportPosition(getDb(), toActor(s), { sample });
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    return { ok: true, snapshot: toSnapshot(r.snapshot, (await getSettings(getDb())).staleAfterSeconds) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

export async function clockOutAction(): Promise<ClockActionResult> {
  const s = await session();
  try {
    const r = await clockOut(getDb(), toActor(s));
    revalidatePath("/bollplockare");
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    return { ok: true, finished: { totalMinutes: r.totalMinutes, pausedMinutes: r.pausedMinutes, registeredMinutes: r.registeredMinutes, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt.toISOString() } };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

export type PositionCheck = { ok: true; zone: "INSIDE" | "MARGIN" | "OUTSIDE"; distanceM: number; marginM: number; accuracyM: number } | { ok: false; message: string };

/**
 * Visar bara var man befinner sig i förhållande till arbetsområdet innan man klockar in. SPARAR ALDRIG något:
 * ingen position lagras utanför ett pågående pass.
 */
export async function checkPositionAction(input: SampleInput): Promise<PositionCheck> {
  await session();
  const sample = toSample(input);
  if (!sample || sample.kind !== "position") return { ok: false, message: "Ingen position." };
  const [area, settings] = await Promise.all([getWorkArea(getDb()), getSettings(getDb())]);
  if (!area.configured) return { ok: false, message: "Arbetsområdet är inte inställt än." };
  if (sample.accuracyM > settings.maxAccuracyMeters) return { ok: false, message: `GPS-signalen är osäker (±${Math.round(sample.accuracyM)} m).` };
  const c = classifyPosition([sample.lat, sample.lng], area.rings, area.marginMeters, sample.accuracyM);
  return { ok: true, zone: c.zone, distanceM: c.distanceM, marginM: area.marginMeters, accuracyM: sample.accuracyM };
}

export async function approveShiftAction(formData: FormData): Promise<void> {
  const s = await requirePermission("shift:respond:own");
  const id = formData.get("shiftId");
  if (typeof id === "string" && id) await approveMyShift(getDb(), toActor(s), id);
  revalidatePath("/bollplockare/schema");
  revalidatePath("/bollplockare");
}
