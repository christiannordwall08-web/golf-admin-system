import { isDevPreviewEnabled } from "@/server/dev-preview";
import type { UserRole } from "@/domain/roles";
import { cn } from "@/lib/utils";

const ITEMS: { role: UserRole; segment: string; label: string }[] = [
  { role: "ADMIN", segment: "admin", label: "Admin" },
  { role: "GOLFSHOP", segment: "golfshop", label: "Golfshop" },
  { role: "BOLLPLOCKARE", segment: "bollplockare", label: "Bollplockare" },
];

/**
 * Flytande växlare, bara i lokalt förhandsvisningsläge (annars renderas ingenting).
 * Vanliga länkar (inte next/link) eftersom GET skapar en session och inte ska förhämtas.
 */
export function DevPreviewBar({ current }: { current: UserRole }) {
  if (!isDevPreviewEnabled()) return null;
  return (
    <div
      role="navigation"
      aria-label="Förhandsvisning"
      className="fixed right-3 bottom-3 z-40 flex items-center gap-1 rounded-full border border-warning-200 bg-warning-50 p-1 pl-3 text-xs shadow-pop"
    >
      <span className="mr-1 font-semibold text-warning-700">Förhandsvisning</span>
      {ITEMS.map((i) => (
        <a
          key={i.role}
          href={`/dev/as/${i.segment}`}
          aria-current={i.role === current ? "true" : undefined}
          className={cn(
            "rounded-full px-2.5 py-1 font-medium",
            i.role === current ? "bg-brand-700 text-white" : "text-warning-700 hover:bg-white",
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
