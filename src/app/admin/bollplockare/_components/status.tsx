import { Badge } from "@/components/ui/badge";
import { GPS_LABEL, type Tone } from "@/app/bollplockare/_components/gps-labels";
import type { DisplayGpsStatus } from "@/modules/bollplockare/domain/tracking";
import { WORK_STATE_LABEL, type WorkState } from "@/modules/bollplockare/domain/worktime";

const STATE_TONE: Record<WorkState, "neutral" | "info" | "success" | "warning" | "danger" | "brand"> = {
  SCHEDULED: "neutral",
  AWAITING_CHECK_IN: "warning",
  ACTIVE: "success",
  PAUSED: "danger",
  COMPLETED: "info",
  NEEDS_REVIEW: "warning",
  APPROVED: "brand",
  CANCELLED: "neutral",
};

export function StateBadge({ state }: { state: WorkState }) {
  return <Badge tone={STATE_TONE[state]}>{WORK_STATE_LABEL[state]}</Badge>;
}

const GPS_TONE: Record<Tone, "success" | "warning" | "danger" | "neutral"> = { green: "success", yellow: "warning", orange: "warning", red: "danger", gray: "neutral" };

export function GpsBadge({ status }: { status: DisplayGpsStatus }) {
  const g = GPS_LABEL[status];
  return <Badge tone={GPS_TONE[g.tone]}>{g.label}</Badge>;
}
