import { type RatePeriod, PayRateError, planRateChange, resolveRateForDate } from "@/domain/pay-rates";
import { type UserRole, can } from "@/domain/roles";
import { dateStringToDbDate, dbDateToString } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";

/**
 * Mönster för alla tjänster i systemet:
 *  1. Ta emot `actor` (från sessionen, aldrig från formulär) och kontrollera behörighet FÖRST.
 *  2. Gör affärsreglerna i rena domänfunktioner (src/domain).
 *  3. Skriv ändring + revisionslogg i EN transaktion.
 *  4. Kasta AppError-typer som Server Actions översätter till meddelanden.
 */
export type Actor = { id: string; role: UserRole };

function toPeriod(row: { id: string; hourlyRateOre: number; validFrom: Date; validTo: Date | null }): RatePeriod {
  return {
    id: row.id,
    hourlyRateOre: row.hourlyRateOre,
    validFrom: dbDateToString(row.validFrom),
    validTo: row.validTo ? dbDateToString(row.validTo) : null,
  };
}

export async function listPayRateHistory(db: DbClient, actor: Actor, employeeId: string): Promise<RatePeriod[]> {
  if (!can(actor.role, "payrates:read:all")) throw new ForbiddenError();
  const rows = await db.payRate.findMany({ where: { employeeId }, orderBy: { validFrom: "asc" } });
  return rows.map(toPeriod);
}

/** Lönenivån som gällde en viss arbetsdag (Stockholm-datum "YYYY-MM-DD"). */
export async function getRateForWorkDate(
  db: DbClient,
  actor: Actor,
  employeeId: string,
  workDate: string,
): Promise<RatePeriod | null> {
  const history = await listPayRateHistory(db, actor, employeeId);
  return resolveRateForDate(history, workDate);
}

/**
 * Sätter ny timlön från ett visst datum. Endast Admin. Stänger nuvarande period och öppnar
 * en ny – historiska perioder (och därmed redan arbetade pass) påverkas aldrig.
 */
export async function changeHourlyRate(
  db: PrismaClient,
  actor: Actor,
  input: { employeeId: string; hourlyRateOre: number; effectiveFrom: string; reason?: string },
): Promise<{ payRateId: string }> {
  if (!can(actor.role, "payrates:write")) throw new ForbiddenError("Endast Admin får ändra timlön.");

  return db.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } });
    if (!employee) throw new NotFoundError("Den anställde finns inte.");

    const periods = (await tx.payRate.findMany({ where: { employeeId: employee.id } })).map(toPeriod);
    let plan;
    try {
      plan = planRateChange(periods, { hourlyRateOre: input.hourlyRateOre, effectiveFrom: input.effectiveFrom });
    } catch (e) {
      if (e instanceof PayRateError) throw new ValidationError(e.message);
      throw e;
    }

    // Ordning är viktig: stäng nuvarande period innan den nya läggs in (överlappsskydd i databasen).
    if (plan.close) {
      await tx.payRate.update({
        where: { id: plan.close.id },
        data: { validTo: dateStringToDbDate(plan.close.validTo) },
      });
    }
    const created = await tx.payRate.create({
      data: {
        employeeId: employee.id,
        hourlyRateOre: plan.insert.hourlyRateOre,
        validFrom: dateStringToDbDate(plan.insert.validFrom),
        reason: input.reason,
        createdById: actor.id,
      },
    });

    const previous = plan.close ? periods.find((p) => p.id === plan.close!.id) : undefined;
    await writeAudit(tx, {
      actorId: actor.id,
      action: "PAYRATE_CHANGED",
      entityType: "Employee",
      entityId: employee.id,
      before: previous ? { hourlyRateOre: previous.hourlyRateOre, validFrom: previous.validFrom } : undefined,
      after: { hourlyRateOre: created.hourlyRateOre, validFrom: plan.insert.validFrom },
      metadata: input.reason ? { reason: input.reason } : undefined,
    });
    return { payRateId: created.id };
  });
}
