import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-11 w-full rounded-lg border border-line bg-white px-3 text-base text-ink shadow-card placeholder:text-ink-muted/70 focus-visible:border-brand-500 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}
