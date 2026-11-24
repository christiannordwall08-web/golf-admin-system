import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/domain/roles";
import { Brand } from "./brand";
import { DevPreviewBar } from "./dev-preview-bar";
import { MobileNav } from "./mobile-nav";
import type { NavItem } from "./nav-config";
import { NavLinks } from "./nav-links";

export function AppShell({
  user,
  nav,
  children,
}: {
  user: { displayName: string; roleLabel: string; role: UserRole };
  nav: NavItem[];
  children: ReactNode;
}) {
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
      <DevPreviewBar current={user.role} />
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-white p-4 lg:flex">
        <Brand className="px-1 pt-1" />
        <div className="flex-1 overflow-y-auto">
          <NavLinks items={nav} />
        </div>
        <div className="border-t border-line pt-4">
          <p className="truncate text-sm font-medium text-ink">{user.displayName}</p>
          <p className="mb-2 text-xs text-ink-muted">{user.roleLabel}</p>
          {signOut}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white/90 px-3 backdrop-blur lg:hidden">
          <MobileNav items={nav} />
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
