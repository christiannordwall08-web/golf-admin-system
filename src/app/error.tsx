"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Detaljer loggas på servern; här visas aldrig tekniska felmeddelanden för användaren.
    console.error(error.digest ?? "client error");
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">Något gick fel</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Vi kunde inte slutföra det du försökte göra. Försök igen. Om felet kvarstår, kontakta administratören.
      </p>
      {error.digest ? <p className="text-xs text-ink-muted">Felreferens: {error.digest}</p> : null}
      <Button className="mt-2" onClick={reset}>
        Försök igen
      </Button>
    </main>
  );
}
