"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { monthParam } from "@/domain/calendar";
import type { WorkCategory } from "@/domain/roles";
import { DEFAULT_SHIFT_TIMES, type ShiftIssue } from "@/domain/shifts";
import { stockholmYearMonth } from "@/domain/time";
import { requirePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError, ConflictError, UnauthenticatedError } from "@/server/errors";
import { type ShiftWriteResult, cancelShift, createShift, publishShifts, restoreShift, updateShift } from "@/server/services/shifts";

/**
 * Server Actions för schemat (Admin). Varje åtgärd hämtar användaren och kontrollerar behörighet på servern,
 * validerar indata med Zod och lämnar affärsreglerna till tjänsten. Formulärets värden skickas tillbaka vid
 * fel så att inget som skrivits in går förlorat.
 */
export type ShiftFormValues = {
  employeeId: string;
  date: string;
  from: string;
  to: string;
  endsNextDay: boolean;
  notes: string;
  publish: boolean;
};

export type ShiftFormState = {
  errors?: string[];
  warnings?: string[];
  /** true = bara varningar: visa "Spara ändå". */
  needsConfirm?: boolean;
  values?: ShiftFormValues;
};

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());
const shiftSchema = z.object({
  employeeId: z.string().min(1, "Välj en anställd.").max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum."),
  from: z.string().regex(/^\d{2}:\d{2}$/, "Ange starttid."),
  to: z.string().regex(/^\d{2}:\d{2}$/, "Ange sluttid."),
  endsNextDay: checkbox,
  notes: z.string().max(200, "Noteringen får vara högst 200 tecken.").default(""),
  publish: checkbox,
  confirm: checkbox,
  version: z.coerce.number().int().min(1).optional(),
});

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function readValues(formData: FormData): ShiftFormValues {
  const on = (k: string) => ["on", "true", "1"].includes(text(formData, k));
  return {
    employeeId: text(formData, "employeeId"),
    date: text(formData, "date"),
    from: text(formData, "from"),
    to: text(formData, "to"),
    endsNextDay: on("endsNextDay"),
    notes: text(formData, "notes"),
    publish: on("publish"),
  };
}

const messages = (issues: ShiftIssue[], severity: ShiftIssue["severity"]) =>
  issues.filter((i) => i.severity === severity).map((i) => i.message);

function toState(result: Extract<ShiftWriteResult, { ok: false }>, values: ShiftFormValues): ShiftFormState {
  return {
    errors: messages(result.issues, "error"),
    warnings: messages(result.issues, "warning"),
    needsConfirm: result.needsConfirm,
    values,
  };
}

function backToSchedule(category: WorkCategory, startsAt: Date, flash: string): never {
  const qs = new URLSearchParams({
    m: monthParam(stockholmYearMonth(startsAt)),
    kat: category === "GOLFSHOP" ? "golfshop" : "bollplockare",
    sparat: flash,
  });
  redirect(`/admin/schema?${qs.toString()}`);
}

/** Översätter förväntade fel till ett meddelande i formuläret. Övriga fel kastas vidare (felsidan). */
function errorState(e: unknown, values?: ShiftFormValues): ShiftFormState {
  if (e instanceof ConflictError) {
    return { errors: ["Passet ändrades av någon annan under tiden. Ladda om sidan och försök igen."], values };
  }
  if (e instanceof UnauthenticatedError) redirect("/login");
  if (e instanceof AppError) return { errors: [e.message], values };
  throw e;
}

export async function createShiftAction(_prev: ShiftFormState, formData: FormData): Promise<ShiftFormState> {
  const values = readValues(formData);
  try {
    const session = await requirePermission("schedule:write");
    const parsed = shiftSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: parsed.error.issues.map((i) => i.message), values };
    const d = parsed.data;
    const result = await createShift(getDb(), { id: session.user.id, role: session.user.actingRole }, {
      employeeId: d.employeeId,
      date: d.date,
      from: d.from,
      to: d.to,
      endsNextDay: d.endsNextDay,
      notes: d.notes.trim() || null,
      publish: d.publish,
      confirmWarnings: d.confirm,
    });
    if (!result.ok) return toState(result, values);
    backToSchedule(result.category, result.startsAt, "skapat");
  } catch (e) {
    return errorState(e, values);
  }
}

export async function updateShiftAction(_prev: ShiftFormState, formData: FormData): Promise<ShiftFormState> {
  const values = readValues(formData);
  try {
    const session = await requirePermission("schedule:write");
    const id = text(formData, "id");
    const parsed = shiftSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success || !id || !parsed.data.version) {
      return { errors: parsed.success ? ["Passet saknar version. Ladda om sidan."] : parsed.error.issues.map((i) => i.message), values };
    }
    const d = parsed.data;
    const result = await updateShift(getDb(), { id: session.user.id, role: session.user.actingRole }, id, {
      employeeId: d.employeeId,
      date: d.date,
      from: d.from,
      to: d.to,
      endsNextDay: d.endsNextDay,
      notes: d.notes.trim() || null,
      expectedVersion: d.version!,
      confirmWarnings: d.confirm,
    });
    if (!result.ok) return toState(result, values);
    backToSchedule(result.category, result.startsAt, "andrat");
  } catch (e) {
    return errorState(e, values);
  }
}

const statusSchema = z.object({
  id: z.string().min(1).max(60),
  version: z.coerce.number().int().min(1),
  confirm: checkbox,
});

/** Ställ in (action=cancel) eller återställ (action=restore) ett pass. */
export async function shiftStatusAction(_prev: ShiftFormState, formData: FormData): Promise<ShiftFormState> {
  try {
    const session = await requirePermission("schedule:write");
    const parsed = statusSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { errors: ["Ogiltig begäran."] };
    const actor = { id: session.user.id, role: session.user.actingRole };
    const restore = text(formData, "action") === "restore";
    const opts = { expectedVersion: parsed.data.version, confirmWarnings: parsed.data.confirm };
    const result = restore
      ? await restoreShift(getDb(), actor, parsed.data.id, opts)
      : await cancelShift(getDb(), actor, parsed.data.id, opts);
    if (!result.ok) {
      return { errors: messages(result.issues, "error"), warnings: messages(result.issues, "warning"), needsConfirm: result.needsConfirm };
    }
    backToSchedule(result.category, result.startsAt, restore ? "aterstallt" : "installt");
  } catch (e) {
    return errorState(e);
  }
}

const publishSchema = z.object({
  category: z.enum(["GOLFSHOP", "BOLLPLOCKARE"]),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export async function publishShiftsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("schedule:publish");
  const parsed = publishSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/schema");
  const { category, year, month } = parsed.data;
  const { published } = await publishShifts(getDb(), { id: session.user.id, role: session.user.actingRole }, { category, year, month });
  const qs = new URLSearchParams({
    m: monthParam({ year, month }),
    kat: category === "GOLFSHOP" ? "golfshop" : "bollplockare",
    publicerat: String(published),
  });
  redirect(`/admin/schema?${qs.toString()}`);
}

export type QuickCreateResult = { ok: true; message: string } | { ok: false; message: string };

const quickSchema = z.object({
  employeeId: z.string().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Dra ett namn till en dag: skapar ett UTKAST med standardtiden (11.00–15.00). Samma regler som "Nytt pass" gäller
 * (ingen dubbelbokning, rätt arbetskategori, bara aktiva). Dagar som passerat kräver "Nytt pass" med bekräftelse.
 */
export async function quickCreateShiftAction(input: { employeeId: string; date: string }): Promise<QuickCreateResult> {
  try {
    const session = await requirePermission("schedule:write");
    const parsed = quickSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Ogiltig dag eller person." };
    const result = await createShift(getDb(), { id: session.user.id, role: session.user.actingRole }, {
      employeeId: parsed.data.employeeId,
      date: parsed.data.date,
      from: DEFAULT_SHIFT_TIMES.from,
      to: DEFAULT_SHIFT_TIMES.to,
      confirmWarnings: false,
    });
    if (!result.ok) {
      const first = result.issues[0]?.message ?? "Passet kunde inte skapas.";
      return { ok: false, message: result.needsConfirm ? `${first} Använd + i dagen om du ändå vill lägga till det.` : first };
    }
    // Bollplockare har ingen fast tid: passet utgår från rangens stängningstid.
    return {
      ok: true,
      message: result.category === "BOLLPLOCKARE" ? "Bollplockarpasset lades till som utkast (ingen fast sluttid)." : `Passet ${DEFAULT_SHIFT_TIMES.from.replace(":", ".")}–${DEFAULT_SHIFT_TIMES.to.replace(":", ".")} lades till som utkast.`,
    };
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}
