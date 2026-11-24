"use client";

import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * GPS-SIMULERING, endast för utveckling (förhandsvisningsläget). Skickar påhittade positioner genom EXAKT samma serverkod
 * som riktiga positioner, så att pauser, återupptagning och notiser kan testas utan att befinna sig på golfbanan.
 * Komponenten renderas bara när servern skickar `simulation` (se isDevPreviewEnabled), aldrig i drift.
 */
export type Scenario = "REAL" | "INSIDE" | "MARGIN" | "OUTSIDE" | "BAD_ACCURACY" | "NO_SIGNAL" | "DENIED" | "JUMP" | "STALE";
export type SimPoints = { inside: [number, number]; margin: [number, number]; outside: [number, number]; far: [number, number] };

const OPTIONS: { key: Scenario; label: string; hint: string }[] = [
  { key: "REAL", label: "Riktig GPS", hint: "Telefonens egen position" },
  { key: "INSIDE", label: "Inom området", hint: "Zon 1" },
  { key: "MARGIN", label: "Säkerhetsmarginal", hint: "Zon 2: precis utanför gränsen" },
  { key: "OUTSIDE", label: "Utanför", hint: "Zon 3: pausas efter verifiering" },
  { key: "BAD_ACCURACY", label: "Dålig noggrannhet", hint: "±300 m: aldrig en avvikelse" },
  { key: "NO_SIGNAL", label: "Ingen GPS-signal", hint: "Position otillgänglig" },
  { key: "DENIED", label: "Åtkomst nekad", hint: "Platsbehörighet nekad" },
  { key: "JUMP", label: "Plötsligt hopp", hint: "Fysiskt omöjligt språng: förkastas" },
  { key: "STALE", label: "Gammal mätning", hint: "10 min gammal: förkastas" },
];

export function GpsSimulator({ scenario, onChange }: { scenario: Scenario; onChange: (s: Scenario) => void }) {
  return (
    <details open className="rounded-xl border border-dashed border-warning-200 bg-warning-50 p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-warning-700">
        <FlaskConical className="size-4" aria-hidden /> GPS-simulering (endast utveckling)
      </summary>
      <p className="mt-2 text-xs text-warning-700">Väljer vilken position som skickas till servern var 15:e sekund. Inget av detta finns i drift.</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Simulerad position">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={scenario === o.key}
            title={o.hint}
            onClick={() => onChange(o.key)}
            className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", scenario === o.key ? "border-warning-700 bg-warning-700 text-white" : "border-warning-200 bg-white text-warning-700 hover:bg-warning-50")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </details>
  );
}
