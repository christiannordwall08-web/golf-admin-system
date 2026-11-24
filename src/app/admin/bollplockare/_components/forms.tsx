"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { WEEKDAY_LABELS } from "@/modules/bollplockare/domain/recurrence";
import type { BollplockareSettingsData } from "@/modules/bollplockare/server/settings";
import { type FormState, correctEntryAction, createAccountAction, resetCodeAction, saveSettingsAction, scheduleManyAction, setOverrideAction } from "../actions";

function Result({ state }: { state: FormState & { summary?: string[] } }) {
  return (
    <>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok ? (
        <Notice tone="success" title={state.ok}>
          {state.code ? (
            <p className="mt-1">
              Personlig kod för <b>{state.name}</b>: <code className="rounded bg-white px-2 py-1 text-base font-semibold tracking-wider select-all">{state.code}</code>
              <br />Koden sparas inte i klartext. Lämna den personligen till bollplockaren.
            </p>
          ) : null}
          {state.summary?.length ? <ul className="mt-1 list-disc pl-5">{state.summary.slice(0, 12).map((s) => <li key={s}>{s}</li>)}</ul> : null}
        </Notice>
      ) : null}
    </>
  );
}

const num = (label: string, name: string, value: number, hint: string, min: number, max: number) => (
  <div key={name}>
    <Label htmlFor={name}>{label}</Label>
    <Input id={name} name={name} type="number" inputMode="numeric" min={min} max={max} defaultValue={value} required />
    <p className="mt-1 text-xs text-ink-muted">{hint}</p>
  </div>
);

export function SettingsForm({ settings }: { settings: BollplockareSettingsData }) {
  const [state, action] = useActionState<FormState, FormData>(saveSettingsAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <Result state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="defaultCloseTime">Rangens vanliga stängningstid</Label>
          <Input id="defaultCloseTime" name="defaultCloseTime" type="time" defaultValue={settings.defaultCloseTime} required />
          <p className="mt-1 text-xs text-ink-muted">Bollplockarnas arbete utgår från den här tiden.</p>
        </div>
        {num("Incheckning öppnar före stängning (minuter)", "checkInMarginMinutes", settings.checkInMarginMinutes, "Standard 20. Tidigast 20.00 − 20 min = 19.40.", 0, 180)}
        {num("Verifieringstid vid avvikelse (sekunder)", "verificationSeconds", settings.verificationSeconds, "Hur länge en avvikelse måste bestå innan tiden pausas. Standard 30.", 5, 600)}
        {num("Sämsta godtagbara GPS-noggrannhet (meter)", "maxAccuracyMeters", settings.maxAccuracyMeters, "Sämre mätningar räknas som osäkra och kan aldrig ge en avvikelse.", 5, 500)}
        {num("Position räknas som gammal efter (sekunder)", "staleAfterSeconds", settings.staleAfterSeconds, "Äldre positioner visas aldrig som aktuella.", 30, 3600)}
        {num("Återupptagning: meter innanför marginalen", "returnHysteresisMeters", settings.returnHysteresisMeters, "Förhindrar att tiden pausas och återupptas om och om igen vid gränsen.", 0, 100)}
        {num("Lagringstid för positioner (dagar)", "gpsRetentionDays", settings.gpsRetentionDays, "Koordinater från pauser raderas efter så här många dagar.", 1, 365)}
        {num("Påminnelse om utcheckning efter (minuter)", "clockOutReminderMinutes", settings.clockOutReminderMinutes, "Bollplockaren och admin påminns. Tiden ändras aldrig automatiskt.", 30, 1440)}
        {num("Utebliven incheckning efter stängning (minuter)", "noShowAfterMinutes", settings.noShowAfterMinutes, "Admin notifieras om ingen klockat in.", 5, 480)}
      </div>
      <div><SubmitButton pendingText="Sparar…">Spara inställningar</SubmitButton></div>
    </form>
  );
}

export function OverrideForm() {
  const [state, action] = useActionState<FormState, FormData>(setOverrideAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Result state={state} />
      <div className="grid gap-4 sm:grid-cols-4">
        <div><Label htmlFor="odate">Datum</Label><Input id="odate" name="date" type="date" required /></div>
        <div>
          <Label htmlFor="okind">Typ</Label>
          <select id="okind" name="kind" defaultValue="time" className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
            <option value="time">Avvikande stängningstid</option>
            <option value="closed">Stängd dag</option>
          </select>
        </div>
        <div><Label htmlFor="ocloseTime">Stänger (om avvikande)</Label><Input id="ocloseTime" name="closeTime" type="time" defaultValue="18:00" /></div>
        <div><Label htmlFor="onote">Notering</Label><Input id="onote" name="note" maxLength={200} placeholder="t.ex. klubbtävling" /></div>
      </div>
      <div><SubmitButton pendingText="Sparar…">Spara dagen</SubmitButton></div>
    </form>
  );
}

export function PlanForm({ people, defaultFrom, defaultTo }: { people: { id: string; name: string }[]; defaultFrom: string; defaultTo: string }) {
  const [state, action] = useActionState<FormState & { summary?: string[] }, FormData>(scheduleManyAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <Result state={state} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Vilka bollplockare?</legend>
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type="checkbox" name="employeeId" value={p.id} className="accent-brand-700" /> {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="from">Från datum</Label><Input id="from" name="from" type="date" defaultValue={defaultFrom} required /></div>
        <div><Label htmlFor="to">Till datum</Label><Input id="to" name="to" type="date" defaultValue={defaultTo} required /></div>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Återkommande veckodagar (inom perioden)</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((d, i) => (
            <label key={d} className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type="checkbox" name="weekday" value={i + 1} className="accent-brand-700" /> {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <Label htmlFor="extraDates">Enstaka datum (valfritt, ÅÅÅÅ-MM-DD, separera med mellanslag)</Label>
        <Input id="extraDates" name="extraDates" placeholder="2026-12-24 2026-12-31" />
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="publish" className="mt-1 accent-brand-700" /><span><b>Publicera direkt</b> (annars blir de utkast som bara admin ser)</span></label>
      <p className="text-xs text-ink-muted">Ingen sluttid anges: bollplockarna arbetar tills bollarna är plockade och incheckning öppnar före rangens stängningstid. Stängda dagar och dubbelbokningar hoppas över.</p>
      <div><SubmitButton pendingText="Lägger in…">Lägg in dagarna</SubmitButton></div>
    </form>
  );
}

export function NewAccountForm() {
  const [state, action] = useActionState<FormState, FormData>(createAccountAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Result state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div><Label htmlFor="firstName">Förnamn</Label><Input id="firstName" name="firstName" required maxLength={80} autoComplete="off" /></div>
        <div><Label htmlFor="lastName">Efternamn</Label><Input id="lastName" name="lastName" required maxLength={80} autoComplete="off" /></div>
        <div><Label htmlFor="email">E-postadress (inloggning)</Label><Input id="email" name="email" type="email" required autoComplete="off" /></div>
      </div>
      <div><SubmitButton pendingText="Skapar…">Skapa konto och personlig kod</SubmitButton></div>
    </form>
  );
}

export function ResetCodeButton({ employeeId, name }: { employeeId: string; name: string }) {
  const [state, action] = useActionState<FormState, FormData>(resetCodeAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="employeeId" value={employeeId} /><input type="hidden" name="name" value={name} />
      <Button type="submit" variant="secondary" size="sm" onClick={(e) => { if (!window.confirm(`Skapa en ny kod åt ${name}? Den gamla slutar fungera och ${name} loggas ut överallt.`)) e.preventDefault(); }}>Ny kod</Button>
      <Result state={state} />
    </form>
  );
}

export function CorrectionForm({
  entryId, version, startedAt, endedAt, pausedMinutes, pauses,
}: { entryId: string; version: number; startedAt: string; endedAt: string; pausedMinutes: number; pauses: { id: string; label: string; voided: boolean }[] }) {
  const [state, action] = useActionState<FormState, FormData>(correctEntryAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={entryId} /><input type="hidden" name="version" value={version} />
      <Result state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div><Label htmlFor="startedAt">Incheckning</Label><Input id="startedAt" name="startedAt" type="datetime-local" defaultValue={startedAt} required /></div>
        <div><Label htmlFor="endedAt">Utcheckning</Label><Input id="endedAt" name="endedAt" type="datetime-local" defaultValue={endedAt} required /></div>
        <div><Label htmlFor="pausedMinutes">Paustid (minuter, lämna tomt = räkna från pauserna)</Label><Input id="pausedMinutes" name="pausedMinutes" type="number" min={0} placeholder={String(pausedMinutes)} /></div>
      </div>
      {pauses.filter((p) => !p.voided).length ? (
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium">Rätta geografiska pauser (de räknas då inte längre, men finns kvar i historiken)</legend>
          {pauses.filter((p) => !p.voided).map((p) => (
            <label key={p.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" name="voidPause" value={p.id} className="accent-brand-700" /> {p.label}</label>
          ))}
        </fieldset>
      ) : null}
      <div>
        <Label htmlFor="reason">Anledning (krävs, sparas i ändringshistoriken)</Label>
        <textarea id="reason" name="reason" required minLength={5} maxLength={500} rows={2} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" placeholder="t.ex. Glömde klocka ut, var klar 21.05 enligt kollega" />
      </div>
      <div><SubmitButton pendingText="Sparar…">Korrigera och godkänn</SubmitButton></div>
    </form>
  );
}
