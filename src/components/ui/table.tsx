import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Tabell med horisontell scroll på små skärmar. */
export function TableWrap({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("overflow-x-auto rounded-card border border-line bg-white shadow-card", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function Th({ className, align = "left", ...props }: ComponentProps<"th"> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line bg-stone-50/70 px-3 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-ink-muted uppercase",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, align = "left", ...props }: ComponentProps<"td"> & { align?: "left" | "right" }) {
  return (
    <td
      className={cn("border-b border-line px-3 py-2.5 align-middle whitespace-nowrap", align === "right" && "text-right tabular-nums", className)}
      {...props}
    />
  );
}
