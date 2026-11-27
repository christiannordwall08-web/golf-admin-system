"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { DEFAULT_SHIFT_TIMES } from "@/domain/shifts";
import { type OpenShiftFormState, createOpenShiftAction } from "./actions";

/** Lägg ut ett ledigt pass. Servern kontrollerar allt; formuläret hjälper bara till. Värden behålls vid fel. */
export function OpenShiftForm({ defaultDate, defaultAuto }: { defaultDate: string; defaultAuto: boolean }) {
  const [state, action] = useActionState<OpenShiftFormState, FormData>(createOpenShiftAction, {});
  const v = state.values ?? {};
  const [category, setCategory] = useState(v.category ?? "GOLFSHOP");
  const bollplockare = category === "BOLLPLOCKARE";
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="os-category">Grupp</Label>
          <Select id="os-category" name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="GOLFSHOP">Golfshop</option>
            <option value="BOLLPLOCKARE">Bollplockare</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="os-date">Datum</Label>
          <Input id="os-date" name="date" type="date" required defaultValue={v.date ?? defaultDate} />
        </div>
      </div>
      {bollplockare ? (
        <p className="text-sm text-ink-muted">Bollplockarpass har ingen fast sluttid. Passet utgår från rangens stängningstid den dagen.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="os-from">Från</Label>
            <Input id="os-from" name="from" type="time" required defaultValue={v.from ?? DEFAULT_SHIFT_TIMES.from} />
          </div>
          <div>
            <Label htmlFor="os-to">Till</Label>
            <Input id="os-to" name="to" type="time" required defaultValue={v.to ?? DEFAULT_SHIFT_TIMES.to} />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="endsNextDay" defaultChecked={v.endsNextDay === "on"} className="size-4" /> Slutar nästa dag
          </label>
        </div>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Hur tillsätts passet?</legend>
        {[
          {
            key: "auto",
            title: "Först till kvarn",
            hint: "Den första som kan ta passet får det direkt. Du får en notis.",
          },
          {
            key: "choose",
            title: "Jag väljer",
            hint: "Personalen anmäler intresse. Du väljer vem som får passet.",
          },
        ].map((o) => (
          <label
            key={o.key}
            className="flex cursor-pointer gap-3 rounded-xl border border-line bg-white p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
          >
            <input
              type="radio"
              name="autoAssign"
              value={o.key}
              defaultChecked={(v.autoAssign ?? (defaultAuto ? "auto" : "choose")) === o.key}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="block text-sm text-ink-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <Label htmlFor="os-notes">Notering (valfri)</Label>
        <Input id="os-notes" name="notes" maxLength={200} defaultValue={v.notes ?? ""} placeholder="T.ex. öppnar shoppen" />
      </div>
      <SubmitButton size="lg" pendingText="Lägger ut…">
        Lägg ut passet
      </SubmitButton>
      <p className="text-sm text-ink-muted">Bara de som kan ta passet får en notis: aktiva i gruppen som inte redan jobbar då.</p>
    </form>
  );
}
