"use client";

import { Camera } from "lucide-react";
import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { type ClosingFormState, submitClosingAction } from "./actions";

export function ClosingForm({ dates }: { dates: { value: string; label: string }[] }) {
  const [state, formAction] = useActionState<ClosingFormState, FormData>(submitClosingAction, {});
  const [preview, setPreview] = useState<string | null>(null);

  return (
    // key: formuläret nollställs (inklusive vald bild) först efter en lyckad inskickning.
    <form key={state.nonce ?? "form"} action={formAction} className="flex flex-col gap-4">
      {state.ok ? <Notice tone="success">{state.message}</Notice> : null}
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      <div>
        <Label htmlFor="photo">Bild på dagsavslutet</Label>
        {/* capture öppnar kameran direkt på mobilen; på dator väljs en fil. Typen kontrolleras ändå på servern. */}
        <label
          htmlFor="photo"
          className="mt-1 flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line bg-white p-4 text-center text-sm text-ink-muted hover:border-brand-400 hover:bg-brand-50/40"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- lokal förhandsvisning av vald fil (blob-URL)
            <img src={preview} alt="Förhandsvisning av vald bild" className="max-h-64 rounded-lg object-contain" />
          ) : (
            <>
              <Camera className="size-8 text-brand-700" aria-hidden />
              <span className="font-medium text-ink">Ta en bild eller välj en bild</span>
              <span>JPEG, PNG eller WebP, högst 10 MB</span>
            </>
          )}
        </label>
        <input
          id="photo"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          required
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPreview((old) => {
              if (old) URL.revokeObjectURL(old);
              return file ? URL.createObjectURL(file) : null;
            });
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="workDate">Dagen avslutet gäller</Label>
          <Select id="workDate" name="workDate" defaultValue={state.values?.workDate ?? dates[0]?.value}>
            {dates.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="total">Dagens summa (kr)</Label>
          <Input id="total" name="total" inputMode="decimal" autoComplete="off" placeholder="t.ex. 12 345,50" defaultValue={state.values?.total} required />
        </div>
      </div>

      <div>
        <Label htmlFor="note">Kommentar (valfritt)</Label>
        <Input id="note" name="note" maxLength={500} defaultValue={state.values?.note} placeholder="t.ex. kassadifferens, regn på eftermiddagen" />
      </div>

      <SubmitButton size="lg" pendingText="Skickar…" className="w-full sm:w-auto">Skicka dagsavslut</SubmitButton>
    </form>
  );
}
