"use client";

import { useRouter } from "next/navigation";
import { type DragEvent, type ReactNode, createContext, useCallback, useContext, useState, useTransition } from "react";
import { quickCreateShiftAction } from "@/app/admin/schema/actions";
import { cn } from "@/lib/utils";

export type PlannerPerson = { id: string; name: string; category: "GOLFSHOP" | "BOLLPLOCKARE" };

type Ctx = {
  selectedId: string | null;
  select: (id: string | null) => void;
  place: (employeeId: string, date: string) => void;
  pending: boolean;
};
const PlannerContext = createContext<Ctx | null>(null);

const DRAG_TYPE = "application/x-golf-employee";
const CHIP: Record<PlannerPerson["category"], string> = {
  GOLFSHOP: "border-brand-200 bg-brand-100 text-brand-900",
  BOLLPLOCKARE: "border-info-200 bg-info-50 text-info-700",
};

/**
 * Planering i schemat: dra ett namn till en dag (eller klicka på namnet och sedan på dagen, för pekskärm och tangentbord)
 * så skapas ett utkast med standardtiden. Servern gör alla kontroller; här visas bara resultatet.
 */
export function PlannerProvider({ people, defaultLabel, children }: { people: PlannerPerson[]; defaultLabel: string; children: ReactNode }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const place = useCallback(
    (employeeId: string, date: string) => {
      const person = people.find((p) => p.id === employeeId);
      if (!person) return;
      startTransition(async () => {
        const r = await quickCreateShiftAction({ employeeId, date });
        setStatus({ tone: r.ok ? "ok" : "error", text: `${person.name} ${date}: ${r.message}` });
        if (r.ok) router.refresh();
      });
    },
    [people, router],
  );

  return (
    <PlannerContext.Provider value={{ selectedId, select: setSelectedId, place, pending }}>
      <section aria-label="Planera schemat" className="mb-4 rounded-card border border-line bg-white p-4 shadow-card">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Dra ett namn till en dag</h2>
          <p className="text-xs text-ink-muted">
            Standardtid {defaultLabel}. Det blir ett utkast som du kan ändra. På mobil: tryck på namnet och sedan på dagen.
          </p>
        </div>
        {people.length === 0 ? (
          <p className="text-sm text-ink-muted">Det finns inga anställda att planera ännu.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Personal">
            {people.map((p) => {
              const selected = selectedId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    draggable
                    aria-pressed={selected}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, p.id);
                      e.dataTransfer.setData("text/plain", p.name);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setSelectedId(selected ? null : p.id)}
                    className={cn(
                      "cursor-grab rounded-full border px-3.5 py-1.5 text-sm font-medium select-none active:cursor-grabbing",
                      CHIP[p.category],
                      selected && "ring-2 ring-brand-700 ring-offset-1",
                    )}
                  >
                    {p.name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p role="status" aria-live="polite" className={cn("mt-2 min-h-5 text-sm", status?.tone === "error" ? "text-danger-700" : "text-success-700")}>
          {pending ? "Sparar…" : (status?.text ?? "")}
        </p>
      </section>
      {children}
    </PlannerContext.Provider>
  );
}

/** En dag i kalendern som tar emot ett dragit namn (eller ett valt namn när man klickar i dagen). */
export function DayDropZone({ date, className, children }: { date: string; className?: string; children: ReactNode }) {
  const ctx = useContext(PlannerContext);
  const [over, setOver] = useState(false);
  if (!ctx) return <div className={className}>{children}</div>;

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    setOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    ctx.place(id, date);
  };

  return (
    <div
      className={cn(className, over && "bg-brand-100/70 outline-2 -outline-offset-2 outline-brand-600 outline-dashed", ctx.selectedId && "cursor-copy")}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={(e) => {
        // Klick på ett pass eller en länk i dagen ska fortsätta fungera som vanligt.
        if (!ctx.selectedId || (e.target as HTMLElement).closest("a,button")) return;
        ctx.place(ctx.selectedId, date);
      }}
    >
      {children}
    </div>
  );
}
