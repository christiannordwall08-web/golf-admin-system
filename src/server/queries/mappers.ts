import type { HourShift } from "@/domain/hours";
import type { RatePeriod } from "@/domain/pay-rates";
import { dbDateToString } from "@/domain/time";
import type { UserRole } from "@/domain/roles";
import { can } from "@/domain/roles";
import { ForbiddenError } from "@/server/errors";

/** Aktören (från sessionen) för läsfrågor: `role` är SESSIONENS roll (actingRole). */
export type Actor = { id: string; role: UserRole };

export function assertCan(actor: Actor, ...permissions: Parameters<typeof can>[1][]): void {
  for (const permission of permissions) {
    if (!can(actor.role, permission)) throw new ForbiddenError();
  }
}

export function toHourShift(row: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  localDate: Date;
  workStatus: HourShift["workStatus"];
  openEnded?: boolean;
}): HourShift {
  return {
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    localDate: dbDateToString(row.localDate),
    workStatus: row.workStatus,
    openEnded: row.openEnded ?? false,
  };
}

export function toRatePeriods(
  rows: { id: string; hourlyRateOre: number; validFrom: Date; validTo: Date | null }[],
): RatePeriod[] {
  return rows.map((r) => ({
    id: r.id,
    hourlyRateOre: r.hourlyRateOre,
    validFrom: dbDateToString(r.validFrom),
    validTo: r.validTo ? dbDateToString(r.validTo) : null,
  }));
}

export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

const collator = new Intl.Collator("sv");
export const compareNames = (a: { lastName: string; firstName: string }, b: { lastName: string; firstName: string }) =>
  collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName);
