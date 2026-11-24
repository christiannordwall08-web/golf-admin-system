"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { type CreateProfileState, createPreviewProfileAction } from "./actions";

export function CreateProfileForm() {
  const [state, formAction] = useActionState<CreateProfileState, FormData>(createPreviewProfileAction, {});
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="firstName">Förnamn</Label>
          <Input id="firstName" name="firstName" autoComplete="given-name" defaultValue={state.firstName} required autoFocus />
        </div>
        <div>
          <Label htmlFor="lastName">Efternamn</Label>
          <Input id="lastName" name="lastName" autoComplete="family-name" defaultValue={state.lastName} required />
        </div>
      </div>
      <SubmitButton size="lg" pendingText="Skapar konto…">Skapa mitt konto och kom in</SubmitButton>
    </form>
  );
}
