import { Badge } from "@/components/ui/badge";
import type { ShiftPhase } from "@/domain/hours";
import { CATEGORY_LABEL, type WorkCategory } from "@/domain/roles";

export function AdminTag() {
  return <Badge tone="neutral">Admin</Badge>;
}

export function CategoryBadge({ category }: { category: WorkCategory }) {
  return <Badge tone={category === "GOLFSHOP" ? "brand" : "info"}>{CATEGORY_LABEL[category]}</Badge>;
}

const APPROVAL = {
  PENDING: { tone: "warning", text: "Väntar på godkännande" },
  APPROVED: { tone: "success", text: "Godkänt" },
  CHANGE_REQUESTED: { tone: "warning", text: "Ändringsförfrågan" },
  APPROVED_AFTER_SWAP: { tone: "brand", text: "Godkänt efter passbyte" },
} as const;

export function ApprovalBadge({ status }: { status: keyof typeof APPROVAL }) {
  const a = APPROVAL[status];
  return <Badge tone={a.tone}>{a.text}</Badge>;
}

/** Fas enligt SCHEMAT (inte verifierad incheckning). */
const PHASE: Record<ShiftPhase, { tone: "success" | "info" | "neutral" | "danger" | "warning"; text: string }> = {
  COMPLETED: { tone: "success", text: "Genomfört enligt schema" },
  ONGOING: { tone: "info", text: "Pågår enligt schema" },
  UPCOMING: { tone: "neutral", text: "Kommande" },
  CANCELLED: { tone: "danger", text: "Inställt" },
  ABSENT: { tone: "danger", text: "Frånvaro" },
};

export function PhaseBadge({ phase }: { phase: ShiftPhase }) {
  const p = PHASE[phase];
  return <Badge tone={p.tone}>{p.text}</Badge>;
}

export function DraftBadge({ publicationStatus }: { publicationStatus: "DRAFT" | "PUBLISHED" }) {
  return publicationStatus === "DRAFT" ? <Badge tone="neutral">Utkast</Badge> : null;
}
