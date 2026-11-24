import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Slår ihop klasser och löser Tailwind-konflikter (senaste vinner). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
