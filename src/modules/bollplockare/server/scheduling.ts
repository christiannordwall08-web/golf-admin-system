import { can } from "@/domain/roles";
import type { PrismaClient } from "@/server/db-client";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { fullName } from "@/server/queries/mappers";
import type { Actor } from "@/server/services/pay-rates";
import { createShift } from "@/server/services/shifts";
import { MAX_BULK_DATES } from "../domain/recurrence";

export type BulkResult = {
  created: number;
  skipped: { employee: string; date: string; reason: string }[];
};

/**
 * Schemalägger flera bollplockare och flera dagar samtidigt (t.ex. återkommande veckodagar). Varje kombination går genom
 * samma regler som ett enskilt pass (rätt kategori, ingen dubbelbokning, stängda dagar nekas). Det som inte kan läggas in
 * hoppas över och redovisas med anledning; resten läggs in. Inget publiceras om inte `publish` anges.
 */
export async function scheduleBollplockare(
  db: PrismaClient,
  actor: Actor,
  input: { employeeIds: string[]; dates: string[]; publish?: boolean; now?: Date },
): Promise<BulkResult> {
  if (!can(actor.role, "schedule:write")) throw new ForbiddenError("Endast Admin får ändra schemat.");
  if (input.employeeIds.length === 0) throw new ValidationError("Välj minst en bollplockare.");
  if (input.dates.length === 0) throw new ValidationError("Välj minst ett datum.");
  if (input.dates.length > MAX_BULK_DATES || input.employeeIds.length > 30) throw new ValidationError("För många val på en gång.");
  const employees = await db.employee.findMany({ where: { id: { in: input.employeeIds } }, select: { id: true, firstName: true, lastName: true, category: true, status: true } });
  const result: BulkResult = { created: 0, skipped: [] };
  for (const id of input.employeeIds) {
    const e = employees.find((x) => x.id === id);
    if (!e || e.category !== "BOLLPLOCKARE") throw new ValidationError("Bara bollplockare kan väljas här.");
    for (const date of input.dates) {
      const r = await createShift(db, actor, { employeeId: id, date, from: "00:00", to: "00:01", publish: input.publish, confirmWarnings: true, now: input.now });
      if (r.ok) result.created++;
      else result.skipped.push({ employee: fullName(e), date, reason: r.issues[0]?.message ?? "Kunde inte läggas in." });
    }
  }
  return result;
}
