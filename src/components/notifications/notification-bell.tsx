import { Bell } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Klocka med antal olästa. Länkar till den egna notissidan i den här panelen. */
export function NotificationBell({ href, unread, className }: { href: string; unread: number; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={unread > 0 ? `Notiser, ${unread} olästa` : "Notiser"}
      className={cn("relative inline-flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-brand-50 hover:text-ink", className)}
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] leading-4.5 font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
