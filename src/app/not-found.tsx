import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-brand-700">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Sidan finns inte</h1>
      <p className="max-w-sm text-sm text-ink-muted">Länken kan vara felaktig eller så har sidan flyttats.</p>
      <Link href="/" className={buttonVariants({ variant: "primary", className: "mt-2" })}>
        Till startsidan
      </Link>
    </main>
  );
}
