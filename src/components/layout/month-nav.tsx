import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type YearMonth, monthParam, shiftMonth } from "@/domain/calendar";
import { formatMonthYear, stockholmYearMonth } from "@/domain/time";
import { buttonVariants } from "@/components/ui/button";

/** Månadsväljare med föregående/nästa/idag. Övriga filter (`params`) följer med i länkarna. */
export function MonthNav({
  basePath,
  params = {},
  ym,
  now,
}: {
  basePath: string;
  params?: Record<string, string | undefined>;
  ym: YearMonth;
  now: Date;
}) {
  const href = (target: YearMonth) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    qs.set("m", monthParam(target));
    return `${basePath}?${qs.toString()}`;
  };
  const current = stockholmYearMonth(now);
  const isCurrent = current.year === ym.year && current.month === ym.month;
  const label = formatMonthYear(ym.year, ym.month);

  return (
    <div className="flex items-center gap-2" role="navigation" aria-label="Välj månad">
      <Link href={href(shiftMonth(ym, -1))} className={buttonVariants({ variant: "secondary", size: "sm" })} aria-label="Föregående månad">
        <ChevronLeft className="size-4" aria-hidden />
      </Link>
      <span className="min-w-36 text-center text-sm font-semibold capitalize">{label}</span>
      <Link href={href(shiftMonth(ym, 1))} className={buttonVariants({ variant: "secondary", size: "sm" })} aria-label="Nästa månad">
        <ChevronRight className="size-4" aria-hidden />
      </Link>
      {!isCurrent ? (
        <Link href={href(current)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Idag
        </Link>
      ) : null}
    </div>
  );
}
