import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "./card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-muted">{label}</p>
        {Icon ? (
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <Icon className="size-[18px]" aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </Card>
  );
}
