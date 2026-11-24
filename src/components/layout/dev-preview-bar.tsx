import { type PreviewMode, isDevPreviewEnabled } from "@/server/dev-preview";
import { cn } from "@/lib/utils";

const ITEMS: { mode: PreviewMode; label: string }[] = [
  { mode: "admin", label: "Admin" },
  { mode: "golfshop", label: "Anställd · Golfshop" },
  { mode: "bollplockare", label: "Anställd · Bollplockare" },
];

/**
 * Flytande växlare, bara i lokalt förhandsvisningsläge (annars renderas ingenting).
 * Vanliga länkar (inte next/link) eftersom GET skapar en session och inte ska förhämtas.
 */
export function DevPreviewBar({ current }: { current: PreviewMode }) {
  if (!isDevPreviewEnabled()) return null;
  return (
    <div
      role="navigation"
      aria-label="Förhandsvisning"
      className="fixed right-3 bottom-3 z-40 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-end gap-1 rounded-2xl border border-warning-200 bg-warning-50 p-1 pl-3 text-xs shadow-pop"
    >
      <span className="mr-1 font-semibold text-warning-700">Förhandsvisning</span>
      {ITEMS.map((i) => (
        <a
          key={i.mode}
          href={`/dev/as/${i.mode}`}
          aria-current={i.mode === current ? "true" : undefined}
          className={cn(
            "rounded-full px-2.5 py-1 font-medium",
            i.mode === current ? "bg-brand-700 text-white" : "text-warning-700 hover:bg-white",
          )}
        >
          {i.label}
        </a>
      ))}
      <a href="/dev" className="rounded-full px-2.5 py-1 font-medium text-warning-700 hover:bg-white">
        Alla vyer
      </a>
    </div>
  );
}
