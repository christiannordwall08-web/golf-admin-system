"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { type ShiftFormState, shiftStatusAction } from "./actions";

/** Ställ in / återställ ett pass. Passet raderas aldrig; historiken finns kvar. */
export function ShiftStatusActions({ id, version, cancelled }: { id: string; version: number; cancelled: boolean }) {
  const [state, formAction] = useActionState<ShiftFormState, FormData>(shiftStatusAction, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!cancelled && !state.needsConfirm && !window.confirm("Ställa in passet? Det räknas då inte längre som arbetstid.")) e.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="action" value={cancelled ? "restore" : "cancel"} />
      {state.errors?.length ? <Notice tone="danger">{state.errors.join(" ")}</Notice> : null}
      {state.warnings?.length ? <Notice tone="warning">{state.warnings.join(" ")}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        {state.needsConfirm ? (
          <SubmitButton variant={cancelled ? "primary" : "danger"} name="confirm" value="on" pendingText="Sparar…">
            {cancelled ? "Återställ ändå" : "Ställ in ändå"}
          </SubmitButton>
        ) : (
          <SubmitButton variant={cancelled ? "primary" : "danger"} pendingText="Sparar…">
            {cancelled ? "Återställ passet" : "Ställ in passet"}
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
