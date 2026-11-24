import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Statusmarkering. Färg är aldrig ensam bärare av betydelse – texten säger alltid statusen. */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-stone-100 text-stone-700",
        brand: "bg-brand-100 text-brand-800",
        success: "bg-emerald-100 text-emerald-800",
        warning: "bg-warning-50 text-warning-700 ring-1 ring-warning-200 ring-inset",
        danger: "bg-danger-50 text-danger-700 ring-1 ring-danger-200 ring-inset",
        info: "bg-info-50 text-info-700 ring-1 ring-info-200 ring-inset",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
