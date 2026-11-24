"use client";

import { SubmitButton } from "./submit-button";
import type { ButtonProps } from "./button";

/** Skickknapp som frågar först ("Är du säker?"). Avbryter man skickas inte formuläret. */
export function ConfirmSubmitButton({
  confirmText,
  pendingText,
  ...props
}: ButtonProps & { confirmText: string; pendingText?: string }) {
  return (
    <SubmitButton
      pendingText={pendingText}
      {...props}
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    />
  );
}
