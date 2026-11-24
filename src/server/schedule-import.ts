import { randomBytes } from "node:crypto";
import { z } from "zod";
import { validateShiftTimes } from "@/domain/shifts";
import { dateStringToDbDate, localToInstant, stockholmDateOf, stockholmYearMonth } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import type { PrismaClient } from "@/server/db-client";
import { ValidationError } from "@/server/errors";
import { previewEmailBase } from "@/server/dev-preview-profile";
import { changeHourlyRate } from "@/server/services/pay-rates";

/**
 * Import av ett (utskrivet) schema till den LOKALA utvecklingsdatabasen. Datafilen ligger utanför git (.local/).
 * Alla personer och pass markeras isTestData. Importen är idempotent: körs den igen skapas inget dubbelt.
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const scheduleImportSchema = z.object({
  category: z.enum(["GOLFSHOP", "BOLLPLOCKARE"]),
  /** Fri anteckning om filen (t.ex. att timlönen är en platshållare). */
  note: z.string().optional(),
  /** Passens godkännandestatus. Utskrivet schema som delats ut räknas som godkänt. */
  approvalStatus: z.enum(["PENDING", "APPROVED"]).default("APPROVED"),
  employees: z
    .array(
      z.object({
        firstName: z.string().trim().min(1),
        /** Tomt om bara förnamn finns. */
        lastName: z.string().trim().default(""),
        /**
         * Administratör som styr över de anställda. Skapar ett admin-konto (utan användbart lösenord, så ingen kan logga in
         * förrän riktiga konton skapas) kopplat till personens anställning, så att hen kan stå i schemat.
         */
        admin: z.boolean().default(false),
        /** Ingår i timlön? Standard: ja, utom för administratörer (sätt true om en admin ändå har timlön). */
        hourlyPaid: z.boolean().optional(),
        /** Fast månadslön i stället för timlön (kräver att personen inte ingår i timlön). */
        fixedSalary: z.boolean().default(false),
        /** Får dagsavslut (notis och bild). Gäller administratörer. */
        receivesDailyClosings: z.boolean().default(false),
        hourlyRateKr: z.number().min(0).optional(),
        rateFrom: date.optional(),
      }),
    )
    .min(1),
  shifts: z.array(
    z.object({
      employee: z.string().trim().min(1),
      date,
      from: time,
      to: time,
      /** Fri text från schemat, t.ex. "öppnar" eller "Fr. 12". Sparas på passet och visas i schemat. */
      notes: z.string().trim().max(200).optional(),
    }),
  ),
});
export type ScheduleImportInput = z.input<typeof scheduleImportSchema>;

export type ImportResult = {
  employeesCreated: string[];
  employeesExisting: string[];
  ratesSet: string[];
  ratesCorrected: string[];
  adminsLinked: string[];
  warnings: string[];
  shiftsCreated: number;
  shiftsSkipped: number;
};

const label = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();

async function importActor(db: PrismaClient) {
  const email = "import@demo.test";
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return db.user.create({
    data: {
      email,
      name: "Lokal import",
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      role: "ADMIN",
      isTestData: true,
    },
  });
}

export async function importSchedule(db: PrismaClient, raw: ScheduleImportInput): Promise<ImportResult> {
  const input = scheduleImportSchema.parse(raw);

  // 1. Validera allt innan något skrivs: namn som matchar exakt en person, giltiga tider.
  const byKey = new Map<string, (typeof input.employees)[number]>();
  for (const e of input.employees) {
    for (const key of new Set([label(e).toLowerCase(), e.firstName.toLowerCase()])) {
      if (byKey.has(key) && byKey.get(key) !== e) byKey.set(key, null as never); // tvetydigt
      else byKey.set(key, e);
    }
  }
  const resolved = input.shifts.map((s) => {
    const e = byKey.get(s.employee.toLowerCase());
    if (!e) throw new ValidationError(`Passet ${s.date}: okänd eller tvetydig person "${s.employee}".`);
    const startsAt = localToInstant(s.date, s.from);
    const endsAt = localToInstant(s.date, s.to);
    const issue = validateShiftTimes({ startsAt, endsAt });
    if (issue) throw new ValidationError(`Passet ${s.date} ${s.from}–${s.to}: ${issue.message}`);
    return { employee: e, date: s.date, startsAt, endsAt, notes: s.notes };
  });

  const actor = await importActor(db);
  const actorRef = { id: actor.id, role: "ADMIN" as const };
  const result: ImportResult = { employeesCreated: [], employeesExisting: [], ratesSet: [], ratesCorrected: [], adminsLinked: [], warnings: [], shiftsCreated: 0, shiftsSkipped: 0 };

  // 2. Personer och timlön.
  const ids = new Map<(typeof input.employees)[number], string>();
  const thisYear = stockholmYearMonth(new Date()).year;
  for (const e of input.employees) {
    const hourlyPaid = e.hourlyPaid ?? !e.admin;
    if (e.fixedSalary && hourlyPaid) throw new ValidationError(`${label(e)}: fast lön kan inte kombineras med timlön.`);
    if (e.receivesDailyClosings && !e.admin) throw new ValidationError(`${label(e)}: bara administratörer kan ta emot dagsavslut.`);
    let employee = await db.employee.findFirst({ where: { firstName: e.firstName, lastName: e.lastName, category: input.category } });
    if (employee) {
      result.employeesExisting.push(label(e));
      if (employee.hourlyPaid !== hourlyPaid || employee.fixedSalary !== e.fixedSalary) {
        employee = await db.employee.update({ where: { id: employee.id }, data: { hourlyPaid, fixedSalary: e.fixedSalary } });
      }
    } else {
      employee = await db.employee.create({
        data: { firstName: e.firstName, lastName: e.lastName, category: input.category, hourlyPaid, fixedSalary: e.fixedSalary, isTestData: true },
      });
      result.employeesCreated.push(label(e));
    }
    ids.set(e, employee.id);

    if (e.admin) {
      if (!employee.userId) {
        // Hitta eller skapa ett admin-testkonto (test-e-post, slumpat lösenord = ingen kan logga in) och koppla det.
        const base = previewEmailBase(e.firstName, e.lastName);
        let email = `${base}@demo.test`;
        let user = await db.user.findUnique({ where: { email } });
        for (let n = 2; user && (user.role !== "ADMIN" || (await db.employee.count({ where: { userId: user.id, category: input.category } })) > 0); n++) {
          email = `${base}.${n}@demo.test`;
          user = await db.user.findUnique({ where: { email } });
        }
        user ??= await db.user.create({
          data: {
            email,
            name: label(e),
            passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
            role: "ADMIN",
            isTestData: true,
          },
        });
        await db.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
        result.adminsLinked.push(label(e));
      } else {
        const linked = await db.user.findUnique({ where: { id: employee.userId }, select: { role: true } });
        if (linked?.role !== "ADMIN") {
          result.warnings.push(`${label(e)}: kontot är redan kopplat och är inte admin. Rollen ändras aldrig av importen.`);
        }
      }
      if (e.receivesDailyClosings) {
        const linkedId = (await db.employee.findUniqueOrThrow({ where: { id: employee.id }, select: { userId: true } })).userId;
        if (linkedId) await db.user.updateMany({ where: { id: linkedId, role: "ADMIN" }, data: { receivesDailyClosings: true } });
      }
    }

    if (e.hourlyRateKr !== undefined) {
      const ore = Math.round(e.hourlyRateKr * 100);
      const from = e.rateFrom ?? `${thisYear}-01-01`;
      const periods = await db.payRate.findMany({ where: { employeeId: employee.id } });
      if (periods.length === 0) {
        await changeHourlyRate(db, actorRef, { employeeId: employee.id, hourlyRateOre: ore, effectiveFrom: from, reason: "Import (lokal)" });
        result.ratesSet.push(label(e));
      } else if (periods.length === 1 && periods[0].hourlyRateOre !== ore) {
        // Rättelse av en felaktig/platshållande startlön i den lokala databasen (loggas).
        await db.$transaction(async (tx) => {
          await tx.payRate.update({ where: { id: periods[0].id }, data: { hourlyRateOre: ore } });
          await writeAudit(tx, {
            actorId: actor.id,
            action: "PAYRATE_CORRECTED_BY_IMPORT",
            entityType: "Employee",
            entityId: employee!.id,
            before: { hourlyRateOre: periods[0].hourlyRateOre },
            after: { hourlyRateOre: ore },
          });
        });
        result.ratesCorrected.push(label(e));
      }
    }
  }

  // 3. Pass (i en transaktion), med månadens schema per kategori.
  await db.$transaction(async (tx) => {
    const schedules = new Map<string, string>();
    for (const s of resolved) {
      const employeeId = ids.get(s.employee)!;
      if (await tx.shift.findFirst({ where: { assignedEmployeeId: employeeId, startsAt: s.startsAt }, select: { id: true } })) {
        result.shiftsSkipped++;
        continue;
      }
      const { year, month } = stockholmYearMonth(s.startsAt);
      const key = `${year}-${month}`;
      if (!schedules.has(key)) {
        const schedule = await tx.schedule.upsert({
          where: { category_year_month: { category: input.category, year, month } },
          create: { category: input.category, year, month, status: "PUBLISHED", publishedAt: new Date() },
          update: {},
        });
        schedules.set(key, schedule.id);
      }
      const shift = await tx.shift.create({
        data: {
          scheduleId: schedules.get(key)!,
          category: input.category,
          assignedEmployeeId: employeeId,
          originalEmployeeId: employeeId,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          localDate: dateStringToDbDate(stockholmDateOf(s.startsAt)),
          publicationStatus: "PUBLISHED",
          approvalStatus: input.approvalStatus,
          notes: s.notes,
          createdById: actor.id,
        },
      });
      await tx.shiftAssignmentHistory.create({
        data: { shiftId: shift.id, toEmployeeId: employeeId, reason: "INITIAL", changedById: actor.id },
      });
      result.shiftsCreated++;
    }
  });
  return result;
}
