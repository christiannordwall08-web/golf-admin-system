import { Loader2 } from "lucide-react";

/**
 * Konsekvent laddningsvy. Använd i en `loading.tsx` PER FUNKTIONSOMRÅDE (t.ex. app/admin/schema/loading.tsx).
 * Lägg ALDRIG en loading.tsx i app/ eller direkt bredvid en layout som gör auth-kontroll:
 * den lägger en Suspense-gräns över layouten, och då levereras en omdirigering som innehåll
 * (HTTP 200) i stället för en riktig 307.
 */
export function LoadingState({ label = "Laddar…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40dvh] items-center justify-center text-ink-muted" role="status" aria-live="polite">
      <Loader2 className="mr-2 size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}
