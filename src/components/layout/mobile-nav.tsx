"use client";

import { Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Brand } from "./brand";
import type { NavItem } from "./nav-config";
import { NavLinks } from "./nav-links";

/** Utfällbar meny för mobil/surfplatta (dolds på stora skärmar där sidofältet visas). */
export function MobileNav({ items, extra }: { items: NavItem[]; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <Button variant="ghost" size="sm" aria-label="Öppna meny" aria-expanded={open} onClick={() => setOpen(true)}>
        <Menu className="size-5" aria-hidden />
      </Button>
      {/* Portal till <body>: ett föräldraelement med backdrop-filter/transform skulle annars
          göra `fixed` relativt sig självt i stället för skärmen. */}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Meny">
              <button
                type="button"
                aria-label="Stäng meny"
                className="absolute inset-0 bg-brand-950/40"
                onClick={() => setOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 bg-white p-4 shadow-pop">
                <div className="flex items-center justify-between">
                  <Brand />
                  <Button ref={closeRef} variant="ghost" size="sm" aria-label="Stäng meny" onClick={() => setOpen(false)}>
                    <X className="size-5" aria-hidden />
                  </Button>
                </div>
                <NavLinks items={items} onNavigate={() => setOpen(false)} />
                {extra ? <div className="mt-auto border-t border-line pt-4">{extra}</div> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
