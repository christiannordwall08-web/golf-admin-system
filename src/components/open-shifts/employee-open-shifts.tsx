import { ArrowLeftRight, CalendarPlus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { CLAIM_STATUS_LABEL } from "@/domain/open-shifts";
import { CATEGORY_HOME, type WorkCategory } from "@/domain/roles";
import { formatDateLong, localToInstant } from "@/domain/time";
import { getDb } from "@/server/db";
import { listOpenShiftsForEmployee } from "@/server/services/open-shifts";
import type { Actor } from "@/server/services/pay-rates";
import { listMySwaps } from "@/server/services/swaps";
import { claimOpenShiftAction, withdrawClaimAction } from "./actions";

/**
 * "Lediga pass" för personal (Planday-modellen): pass som Admin lagt ut + kollegors öppna passbyten, på ett ställe.
 * Mobil först: ett kort per pass, en stor knapp. Används av golfshop och (när Christian lägger till sidan) bollplockare:
 *   export default async function Page({ searchParams }) {
 *     const { session } = await requireEmployeeArea("BOLLPLOCKARE");
 *     return <EmployeeOpenShiftsPage actor={toActor(session)} category="BOLLPLOCKARE" searchParams={await searchParams} />;
 *   }
 */
const FLASH: Record<string, string> = {
  fick: "Passet är ditt! Det ligger nu i ditt schema.",
  anmald: "Du är intresseanmäld. Du får en notis när admin har valt.",
  aterkallad: "Din intresseanmälan är återkallad.",
};

const dayLabel = (date: string) => {
  const s = formatDateLong(localToInstant(date, "12:00"));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export async function EmployeeOpenShiftsPage({
  actor,
  category,
  searchParams,
}: {
  actor: Actor;
  category: WorkCategory;
  searchParams: { klart?: string; fel?: string };
}) {
  const db = getDb();
  const [openShifts, swaps] = await Promise.all([listOpenShiftsForEmployee(db, actor, category), listMySwaps(db, actor, category)]);
  const colleagueSwaps = swaps.filter((s) => s.kind === "OPEN" && s.needsMyAnswer);
  const base = CATEGORY_HOME[category];
  const empty = openShifts.length === 0 && colleagueSwaps.length === 0;

  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title="Lediga pass" description="Pass som du kan ta. Du ser bara pass som inte krockar med ditt schema." />
      {searchParams.fel ? (
        <Notice tone="danger" className="mb-4">
          {searchParams.fel.slice(0, 300)}
        </Notice>
      ) : null}
      {searchParams.klart && FLASH[searchParams.klart] ? (
        <Notice tone="success" className="mb-4">
          {FLASH[searchParams.klart]}
        </Notice>
      ) : null}

      {empty ? (
        <Card>
          <EmptyState icon={CalendarPlus} title="Inga lediga pass just nu">
            Du får en notis när ett pass blir ledigt.
          </EmptyState>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-3">
        {openShifts.map((s) => (
          <li key={s.id}>
            <Card>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold leading-tight">{dayLabel(s.date)}</p>
                    <p className="text-2xl font-semibold tracking-tight tabular-nums">{s.time ?? "Till plockningen är klar"}</p>
                  </div>
                  {s.myClaim ? (
                    <Badge tone={s.myClaim === "PENDING" ? "info" : "neutral"}>{CLAIM_STATUS_LABEL[s.myClaim]}</Badge>
                  ) : (
                    <Badge tone="brand">{s.autoAssign ? "Först till kvarn" : "Admin väljer"}</Badge>
                  )}
                </div>
                {s.notes ? <p className="text-sm text-ink-muted">{s.notes}</p> : null}
                {s.myClaim === "PENDING" ? (
                  <form action={withdrawClaimAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="category" value={category} />
                    <SubmitButton variant="secondary" size="lg" className="w-full" pendingText="Återkallar…">
                      Återkalla intresse
                    </SubmitButton>
                  </form>
                ) : s.blockedBy ? (
                  <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-ink-muted">{s.blockedBy}</p>
                ) : s.myClaim === "REJECTED" ? null : (
                  <form action={claimOpenShiftAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="category" value={category} />
                    <SubmitButton size="lg" className="w-full" pendingText={s.autoAssign ? "Tar passet…" : "Anmäler…"}>
                      {s.autoAssign ? "Ta passet" : "Anmäl intresse"}
                    </SubmitButton>
                  </form>
                )}
              </CardContent>
            </Card>
          </li>
        ))}

        {colleagueSwaps.map((s) => (
          <li key={s.id}>
            <Link href={`${base}/byten/${s.id}`} className="block rounded-card border border-line bg-white p-5 shadow-card hover:bg-brand-50/50">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-lg font-semibold leading-tight">{dayLabel(s.shiftDate)}</span>
                  <span className="block text-sm text-ink-muted">
                    {s.requester} kan inte jobba. {s.reason}
                  </span>
                </span>
                <Badge tone="warning">
                  <ArrowLeftRight className="size-3" aria-hidden /> Kollega
                </Badge>
              </span>
              <span className="mt-3 block text-sm font-medium text-brand-700">Se passet och svara →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
