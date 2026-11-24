"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { CATEGORY_LABEL, type WorkCategory } from "@/domain/roles";
import type { SchedulableEmployee } from "@/server/queries/shift-edit";
import { type ShiftFormState, type ShiftFormValues, createShiftAction, updateShiftAction } from "./actions";

/**
 * Formulär för att skapa eller ändra ett pass. All validering och alla regler körs på servern;
 * formuläret visar bara resultatet (fel, varningar och "Spara ändå").
 */
export function ShiftForm({
  mode,
  employees,
  defaults,
  shift,
  cancelHref,
}: {
  mode: "create" | "edit";
  employees: SchedulableEmployee[];
  defaults: ShiftFormValues;
  shift?: { id: string; version: number };
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<ShiftFormState, FormData>(mode === "create" ? createShiftAction : updateShiftAction, {});
  const v = state.values ?? defaults;
  const [selected, setSelected] = useState(v.employeeId);
  // Bollplockare har inga fasta tider: passet utgår från rangens stängningstid och admin anger ingen sluttid.
  const openEnded = employees.find((e) => e.id === selected)?.category === "BOLLPLOCKARE";
  const categories = [...new Set(employees.map((e) => e.category))] as WorkCategory[];

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {shift ? (
        <>
          <input type="hidden" name="id" value={shift.id} />
          <input type="hidden" name="version" value={shift.version} />
        </>
      ) : null}

      {state.errors?.length ? (
        <Notice tone="danger" title="Passet kunde inte sparas">
          <ul className="list-disc pl-5">{state.errors.map((m) => <li key={m}>{m}</li>)}</ul>
        </Notice>
      ) : null}
      {state.warnings?.length ? (
        <Notice tone="warning" title="Kontrollera innan du sparar">
          <ul className="list-disc pl-5">{state.warnings.map((m) => <li key={m}>{m}</li>)}</ul>
        </Notice>
      ) : null}

      <div>
        <Label htmlFor="employeeId">Anställd</Label>
        {/* key: en <select> plockar inte upp ett nytt defaultValue efter att formuläret återställts, så den omskapas när valet ändras. */}
        <Select key={v.employeeId} id="employeeId" name="employeeId" defaultValue={v.employeeId} required onChange={(e) => setSelected(e.target.value)}>
          {categories.map((c) => (
            <optgroup key={c} label={CATEGORY_LABEL[c]}>
              {employees.filter((e) => e.category === c).map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.isAdmin ? " (admin)" : ""}</option>
              ))}
            </optgroup>
          ))}
        </Select>
        <p className="mt-1 text-xs text-ink-muted">Passet hamnar i schemat för personens arbetsgrupp.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="date">Datum</Label>
          <Input id="date" name="date" type="date" defaultValue={v.date} required />
        </div>
        {openEnded ? (
          <>
            {/* Ignoreras av servern för bollplockare, men fälten krävs av formuläret. */}
            <input type="hidden" name="from" value="11:00" />
            <input type="hidden" name="to" value="15:00" />
            <div className="sm:col-span-2">
              <Notice tone="info" title="Bollplockare har ingen fast sluttid">
                Passet utgår från rangens stängningstid och slutar när bollarna är plockade. Tidigaste incheckning sätts automatiskt (se Range &amp; GPS-inställningar).
              </Notice>
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="from">Starttid</Label>
              <Input id="from" name="from" type="time" step={60} defaultValue={v.from} required />
            </div>
            <div>
              <Label htmlFor="to">Sluttid</Label>
              <Input id="to" name="to" type="time" step={60} defaultValue={v.to} required />
            </div>
          </>
        )}
      </div>

      {openEnded ? null : (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="endsNextDay" defaultChecked={v.endsNextDay} className="size-4 rounded border-line accent-brand-700" />
          Passet slutar nästa dag (nattpass)
        </label>
      )}

      <div>
        <Label htmlFor="notes">Notering (valfri)</Label>
        <Input id="notes" name="notes" defaultValue={v.notes} maxLength={200} placeholder="t.ex. öppnar" />
      </div>

      {mode === "create" ? (
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium">Synlighet</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="publish" value="" defaultChecked={!v.publish} className="mt-1 size-4 accent-brand-700" />
            <span><b>Utkast</b> – syns bara för Admin tills du publicerar schemat.</span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="radio" name="publish" value="on" defaultChecked={v.publish} className="mt-1 size-4 accent-brand-700" />
            <span><b>Publicera direkt</b> – syns genast för personalen.</span>
          </label>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Sparar…">{mode === "create" ? "Skapa pass" : "Spara ändringar"}</SubmitButton>
        {state.needsConfirm ? (
          <SubmitButton variant="secondary" name="confirm" value="on" pendingText="Sparar…">
            Spara ändå
          </SubmitButton>
        ) : null}
        <Link href={cancelHref} className="text-sm text-ink-muted hover:text-ink">Avbryt</Link>
      </div>
    </form>
  );
}
