import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { box: "border-info-200 bg-info-50 text-info-700", Icon: Info },
  success: { box: "border-brand-200 bg-brand-50 text-brand-800", Icon: CheckCircle2 },
  warning: { box: "border-warning-200 bg-warning-50 text-warning-700", Icon: AlertTriangle },
  danger: { box: "border-danger-200 bg-danger-50 text-danger-700", Icon: XCircle },
} as const;

/** Konsekvent meddelanderuta för lyckat/fel/info. Fel och varningar annonseras för skärmläsare. */
export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}
