"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/ui/notice";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import type { WorkCategory } from "@/domain/roles";
import { type SwapFormState, createSwapAction } from "./actions";

type Opt = { id: string; label: string };

const KINDS = [
  { key: "DIRECT", title: "Be en kollega ta mitt pass", hint: "Välj vem. Kollegan får en förfrågan." },
  { key: "OPEN", title: "Öppen förfrågan", hint: "Alla i gruppen kan tacka ja. Den första som svarar tar passet." },
  { key: "EXCHANGE", title: "Byt arbetsdag", hint: "Du tar en kollegas pass och kollegan tar ditt." },
  { key: "CHANGE", title: "Begär ändring av admin", hint: "Ingen kollega. Admin avgör." },
] as const;

/** Formulär för passbyte. Servern kontrollerar allt; formuläret hjälper bara till att välja rätt uppgifter. */
export function NewSwapForm({ category, shifts, colleagues, colleagueShifts, shiftId }: { category: WorkCategory; shifts: Opt[]; colleagues: Opt[]; colleagueShifts: Opt[]; shiftId?: string }) {
  const [state, action] = useActionState<SwapFormState, FormData>(createSwapAction, {});
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("OPEN");
  return (
    <form action={action} className="flex flex-col gap-5">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <input type="hidden" name="category" value={category} />
      <div>
        <Label htmlFor="shiftId">Vilket pass?</Label>
        <Select id="shiftId" name="shiftId" defaultValue={shiftId ?? shifts[0]?.id} required>
          {shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Vad vill du göra?</legend>
        {KINDS.map((k) => (
          <label key={k.key} className="flex cursor-pointer gap-3 rounded-xl border border-line bg-white p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input type="radio" name="kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} className="mt-1" />
            <span><span className="block text-sm font-semibold">{k.title}</span><span className="block text-xs text-ink-muted">{k.hint}</span></span>
          </label>
        ))}
      </fieldset>
      {kind === "DIRECT" ? (
        <div>
          <Label htmlFor="proposedEmployeeId">Kollega</Label>
          <Select id="proposedEmployeeId" name="proposedEmployeeId" required>
            <option value="">Välj kollega</option>
            {colleagues.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </div>
      ) : null}
      {kind === "EXCHANGE" ? (
        <div>
          <Label htmlFor="counterShiftId">Kollegans pass du vill ta i stället</Label>
          <Select id="counterShiftId" name="counterShiftId" required>
            <option value="">Välj pass</option>
            {colleagueShifts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </div>
      ) : null}
      <div>
        <Label htmlFor="reason">Anledning</Label>
        <textarea id="reason" name="reason" required minLength={3} maxLength={500} rows={3} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" placeholder="Kort förklaring till kollegan och admin" />
      </div>
      <SubmitButton size="lg" pendingText="Skickar…">Skicka förfrågan</SubmitButton>
    </form>
  );
}
