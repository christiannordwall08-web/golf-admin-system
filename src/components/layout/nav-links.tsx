"use client";

import {
  ArrowLeftRight,
  CalendarDays,
  Camera,
  Clock,
  FileSpreadsheet,
  LayoutDashboard,
  type LucideIcon,
  MapPin,
  Store,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavIcon, NavItem } from "./nav-config";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  calendar: CalendarDays,
  swap: ArrowLeftRight,
  clock: Clock,
  report: FileSpreadsheet,
  camera: Camera,
  shop: Store,
  pin: MapPin,
};

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Startsidan (första posten) är bara aktiv på exakt sökväg, övriga även för undersidor.
  const rootHref = items[0]?.href;

  return (
    <nav aria-label="Huvudmeny" className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const base = "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium";

        if (item.soon) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              className={cn(base, "cursor-not-allowed text-ink-muted/60 select-none")}
            >
              <Icon className="size-[18px]" aria-hidden />
              <span className="flex-1">{item.label}</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-stone-500 uppercase">
                Snart
              </span>
            </span>
          );
        }

        const active =
          item.href === rootHref ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              base,
              "transition-colors",
              active ? "bg-brand-50 text-brand-800" : "text-ink-muted hover:bg-brand-50/60 hover:text-ink",
            )}
          >
            <Icon className={cn("size-[18px]", active && "text-brand-700")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
