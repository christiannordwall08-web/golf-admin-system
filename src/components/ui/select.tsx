import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-lg border border-line bg-white px-3 text-base text-ink shadow-card focus-visible:border-brand-500 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}
