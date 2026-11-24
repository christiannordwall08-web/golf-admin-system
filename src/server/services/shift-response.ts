import { can } from "@/domain/roles";
import { writeAudit } from "@/server/audit";
import type { PrismaClient } from "@/server/db-client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { Actor } from "./pay-rates";

/**
 * Den anställde godkänner ett publicerat pass som hen är ansvarig för. Beslutet sparas append-only (ShiftApproval)
 * för den version av passet som godkändes. Ändras passet väsentligt krävs ett nytt godkännande (se updateShift).
 * Att begära ändring görs som ett passbyte av typen CHANGE (src/server/services/swaps.ts).
 */
export async function approveMyShift(db: PrismaClient, actor: Actor, shiftId: string, now = new Date()): Promise<void> {
  if (!can(actor.role, "shift:respond:own")) throw new ForbiddenError();
  const shift = await db.shift.findUnique({ where: { id: shiftId }, include: { assignedEmployee: { select: { id: true, userId: true } } } });
  // Samma svar oavsett om passet finns eller tillhör någon annan.
  if (!shift || shift.assignedEmployee.userId !== actor.id) throw new NotFoundError("Passet finns inte.");
  if (shift.publicationStatus !== "PUBLISHED") throw new ValidationError("Passet är inte publicerat än.");
  if (shift.workStatus === "CANCELLED") throw new ValidationError("Passet är inställt.");
  if (shift.endsAt <= now) throw new ValidationError("Passet har redan varit.");
  if (shift.approvalStatus === "APPROVED" || shift.approvalStatus === "APPROVED_AFTER_SWAP") return;
  if (shift.approvalStatus === "CHANGE_REQUESTED") throw new ConflictError("Du har begärt en ändring av passet. Vänta på svar eller avbryt begäran.");
  await db.$transaction(async (tx) => {
    const { count } = await tx.shift.updateMany({ where: { id: shift.id, version: shift.version, approvalStatus: "PENDING" }, data: { approvalStatus: "APPROVED" } });
    if (count === 0) throw new ConflictError("Passet ändrades just nu. Ladda om sidan.");
    await tx.shiftApproval.create({ data: { shiftId: shift.id, employeeId: shift.assignedEmployee.id, shiftVersion: shift.version, decision: "APPROVED" } });
    await writeAudit(tx, { actorId: actor.id, action: "SHIFT_APPROVED_BY_EMPLOYEE", entityType: "Shift", entityId: shift.id, after: { version: shift.version } });
  });
}
