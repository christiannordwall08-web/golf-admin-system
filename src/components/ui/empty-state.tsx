import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

/** Tydligt tomt tillstånd – används även när en funktion ännu inte finns. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children ? <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
