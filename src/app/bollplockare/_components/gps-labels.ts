import type { DisplayGpsStatus } from "@/modules/bollplockare/domain/tracking";

export type Tone = "green" | "yellow" | "orange" | "red" | "gray";

/** Färgklasser per ton: grön = arbetar inom området, gul = verifierar, orange = GPS otillgänglig, röd = pausad. */
export const TONE_CLASS: Record<Tone, { card: string; dot: string; text: string }> = {
  green: { card: "border-brand-300 bg-brand-50", dot: "bg-brand-600", text: "text-brand-900" },
  yellow: { card: "border-yellow-300 bg-yellow-50", dot: "bg-yellow-500", text: "text-yellow-900" },
  orange: { card: "border-orange-300 bg-orange-50", dot: "bg-orange-500", text: "text-orange-900" },
  red: { card: "border-danger-200 bg-danger-50", dot: "bg-danger-600", text: "text-danger-700" },
  gray: { card: "border-line bg-white", dot: "bg-stone-400", text: "text-ink" },
};

export const GPS_LABEL: Record<DisplayGpsStatus, { tone: Tone; label: string }> = {
  NONE: { tone: "gray", label: "Ingen position än" },
  INSIDE: { tone: "green", label: "Inom godkänt område" },
  MARGIN: { tone: "green", label: "Inom säkerhetsmarginal" },
  VERIFYING: { tone: "yellow", label: "Verifierar geografisk avvikelse" },
  OUTSIDE: { tone: "red", label: "Utanför godkänt område" },
  UNRELIABLE: { tone: "orange", label: "GPS-signal osäker" },
  MISSING: { tone: "orange", label: "GPS-signal saknas" },
  DENIED: { tone: "orange", label: "Platsåtkomst nekad" },
  STALE: { tone: "orange", label: "Positionen har inte uppdaterats nyligen" },
};

export function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/** "19.45" i Stockholm-tid. */
export function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }).format(new Date(iso)).replace(":", ".");
}

export function ageText(seconds: number): string {
  if (seconds < 5) return "just nu";
  if (seconds < 90) return `${Math.round(seconds)} s sedan`;
  return `${Math.round(seconds / 60)} min sedan`;
}
