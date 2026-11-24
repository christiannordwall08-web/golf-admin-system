import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand-700 text-white shadow-card">
        <Flag className="size-[18px]" aria-hidden />
      </span>
      <span className="text-[15px] leading-tight font-semibold tracking-tight text-ink">
        Golf Admin
        <span className="block text-[11px] font-normal text-ink-muted">Personal &amp; schema</span>
      </span>
    </div>
  );
}
