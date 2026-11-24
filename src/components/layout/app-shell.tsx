import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Brand } from "./brand";
import { DevPreviewBar } from "./dev-preview-bar";
import type { PreviewMode } from "@/server/dev-preview";
import Link from "next/link";
import { MobileNav } from "./mobile-nav";
import type { NavItem } from "./nav-config";
import { NavLinks } from "./nav-links";

export type AreaLink = { href: string; label: string; current: boolean };

export function AppShell({
  user,
  nav,
  previewCurrent,
  areaLinks,
  children,
}: {
  user: { displayName: string; roleLabel: string };
  nav: NavItem[];
  /** Vilken panel som visas (för förhandsvisningens växlare). */
  previewCurrent: PreviewMode;
  /** Andra arbetsplatser personen har (t.ex. Golfshop och Bollplockare). Visas bara om det finns fler än en. */
  areaLinks?: AreaLink[];
  children: ReactNode;
}) {
  const areaSwitch =
    areaLinks && areaLinks.length > 1 ? (
      <div className="mb-3">
        <p className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Mina arbetsplatser</p>
        <div className="flex flex-wrap gap-1">
          {areaLinks.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              aria-current={a.current ? "page" : undefined}
              className={
                a.current
                  ? "rounded-full bg-brand-700 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-muted hover:bg-brand-50"
              }
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    ) : null;

  const signOut = (
    <form action={logoutAction}>
      <Button type="submit" variant="ghost" size="sm">
        <LogOut className="size-4" aria-hidden />
        Logga ut
      </Button>
    </form>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <DevPreviewBar current={previewCurrent} />
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-white p-4 lg:flex">
        <Brand className="px-1 pt-1" />
        <div className="flex-1 overflow-y-auto">
          <NavLinks items={nav} />
        </div>
        <div className="border-t border-line pt-4">
          {areaSwitch}
          <p className="truncate text-sm font-medium text-ink">{user.displayName}</p>
          <p className="mb-2 text-xs text-ink-muted">{user.roleLabel}</p>
          {signOut}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white/90 px-3 backdrop-blur lg:hidden">
          <MobileNav items={nav} extra={areaSwitch} />
          <Brand className="flex-1" />
          {signOut}
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
