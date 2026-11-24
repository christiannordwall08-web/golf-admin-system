"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { datesForWeekdays } from "@/modules/bollplockare/domain/recurrence";
import { approveWorkEntry, correctWorkEntry } from "@/modules/bollplockare/server/reports";
import { scheduleBollplockare } from "@/modules/bollplockare/server/scheduling";
import { removeDayOverride, saveWorkArea, setDayOverride, updateSettings } from "@/modules/bollplockare/server/settings";
import { requirePermission, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError, UnauthenticatedError } from "@/server/errors";
import { createEmployeeAccount, resetPersonalCode } from "@/server/services/accounts";

/** Server Actions för Admins bollplockarfunktioner. Behörighet kontrolleras först, reglerna ligger i tjänsterna. */
export type FormState = { error?: string; ok?: string; code?: string; name?: string };

const field = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

async function guard<T>(permission: Parameters<typeof requirePermission>[0], run: (actor: ReturnType<typeof toActor>) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const s = await requirePermission(permission);
    if (s.context !== "ADMIN") throw new UnauthenticatedError();
    return { ok: true, value: await run(toActor(s)) };
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function saveWorkAreaAction(input: { polygons: unknown; marginMeters: number; expectedVersion: number }): Promise<{ ok: true; version: number } | { ok: false; message: string }> {
  const r = await guard("range:configure", (actor) => saveWorkArea(getDb(), actor, input));
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath("/admin/bollplockare");
  return { ok: true, version: r.value.version };
}

export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const r = await guard("range:configure", (actor) => updateSettings(getDb(), actor, Object.fromEntries(formData)));
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/bollplockare");
  return { ok: "Inställningarna är sparade. Kommande pass har fått nya incheckningstider." };
}

const overrideSchema = z.object({ date: z.string(), kind: z.enum(["time", "closed"]), closeTime: z.string().optional(), note: z.string().max(200).optional() });

export async function setOverrideAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = overrideSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Ange datum och typ." };
  const r = await guard("range:configure", (actor) =>
    setDayOverride(getDb(), actor, { date: p.data.date, closed: p.data.kind === "closed", closeTime: p.data.kind === "time" ? p.data.closeTime || null : null, note: p.data.note || null }),
  );
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/bollplockare/installningar");
  return { ok: p.data.kind === "closed" ? "Dagen är markerad som stängd." : "Avvikande stängningstid är sparad." };
}

export async function removeOverrideAction(formData: FormData): Promise<void> {
  await guard("range:configure", (actor) => removeDayOverride(getDb(), actor, field(formData, "date")));
  revalidatePath("/admin/bollplockare/installningar");
}

export async function approveEntryAction(formData: FormData): Promise<void> {
  const id = field(formData, "id");
  await guard("worktime:approve", (actor) => approveWorkEntry(getDb(), actor, id));
  revalidatePath("/admin/bollplockare");
  revalidatePath("/admin/rapporter");
  redirect(field(formData, "back") || `/admin/bollplockare/pass/${id}`);
}

export async function correctEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = field(formData, "id");
  const parse = (k: string) => {
    const v = field(formData, k);
    if (!v) return undefined;
    // datetime-local ger Stockholm-lokal tid utan zon: tolka den som svensk tid
    const [d, t] = v.split("T");
    return { d, t };
  };
  const start = parse("startedAt");
  const end = parse("endedAt");
  const { localToInstant } = await import("@/domain/time");
  const to = (x?: { d: string; t: string }) => (x ? localToInstant(x.d, x.t.slice(0, 5)) : undefined);
  const paused = field(formData, "pausedMinutes");
  const r = await guard("worktime:correct", (actor) =>
    correctWorkEntry(getDb(), actor, id, {
      expectedVersion: Number(field(formData, "version")),
      reason: field(formData, "reason"),
      startedAt: to(start),
      endedAt: to(end),
      pausedMinutes: paused === "" ? undefined : Number(paused),
      voidPauseIds: formData.getAll("voidPause").filter((v): v is string => typeof v === "string"),
    }),
  );
  if (!r.ok) return { error: r.error };
  revalidatePath(`/admin/bollplockare/pass/${id}`);
  revalidatePath("/admin/rapporter");
  return { ok: `Korrigerat. Registrerad tid är nu ${r.value.registeredMinutes} min. Bollplockaren har fått en notis.` };
}

const planSchema = z.object({ from: z.string(), to: z.string(), publish: z.string().optional() });

export async function scheduleManyAction(_prev: FormState, formData: FormData): Promise<FormState & { summary?: string[] }> {
  const p = planSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Ange från- och till-datum." };
  const employeeIds = formData.getAll("employeeId").filter((v): v is string => typeof v === "string");
  const weekdays = formData.getAll("weekday").map(Number);
  const extra = field(formData, "extraDates").split(/[\s,;]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  let dates: string[];
  try {
    dates = [...new Set([...(weekdays.length ? datesForWeekdays(p.data.from, p.data.to, weekdays) : []), ...extra])].sort();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Ogiltiga datum." };
  }
  const r = await guard("schedule:write", (actor) => scheduleBollplockare(getDb(), actor, { employeeIds, dates, publish: p.data.publish === "on" }));
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/schema");
  const { created, skipped } = r.value;
  return {
    ok: `${created} pass lades in${p.data.publish === "on" ? " och publicerades" : " som utkast"}.${skipped.length ? ` ${skipped.length} hoppades över.` : ""}`,
    summary: skipped.map((s) => `${s.employee} ${s.date}: ${s.reason}`),
  };
}

const accountSchema = z.object({ firstName: z.string(), lastName: z.string(), email: z.string() });

export async function createAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = accountSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Fyll i alla fält." };
  const r = await guard("employees:write", (actor) => createEmployeeAccount(getDb(), actor, { ...p.data, category: "BOLLPLOCKARE" }));
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/bollplockare/personal");
  return { ok: "Kontot är skapat. Skriv ner koden nu, den visas bara en gång.", code: r.value.code, name: `${p.data.firstName} ${p.data.lastName}` };
}

export async function resetCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const r = await guard("employees:write", (actor) => resetPersonalCode(getDb(), actor, field(formData, "employeeId")));
  if (!r.ok) return { error: r.error };
  return { ok: "Ny kod skapad. Alla inloggningar för kontot har avslutats. Koden visas bara en gång.", code: r.value.code, name: field(formData, "name") };
}
