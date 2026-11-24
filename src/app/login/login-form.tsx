"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import type { SessionContext, Workplace } from "@/domain/roles";
import { type LoginState, loginAction } from "./actions";

export function LoginForm({ audience, next, workplace }: { audience: SessionContext; next?: string; workplace?: Workplace }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="next" value={next ?? ""} />
      <input type="hidden" name="workplace" value={workplace ?? ""} />
      <div>
        <Label htmlFor="email">E-postadress</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          defaultValue={state.email}
          required
          autoFocus={!state.email}
        />
      </div>
      <div>
        <Label htmlFor="password">Lösenord</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus={Boolean(state.email)}
        />
      </div>
      <SubmitButton size="lg" pendingText="Loggar in…" className="mt-1 w-full">
        {audience === "ADMIN" ? "Logga in som Admin" : "Logga in som anställd"}
      </SubmitButton>
    </form>
  );
}
