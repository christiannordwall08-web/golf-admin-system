import { randomBytes } from "node:crypto";
import { dateStringToDbDate, stockholmYearMonth } from "@/domain/time";
import { hashPassword } from "@/server/auth/password";
import { writeAudit } from "@/server/audit";
import { createDemoShifts } from "@/server/demo-data";
import type { PrismaClient } from "@/server/db-client";
import { ValidationError } from "@/server/errors";
import { changeHourlyRate } from "@/server/services/pay-rates";

/** Förnamn/efternamn: bokstäver (även å ä ö), mellanslag, bindestreck och apostrof. 1–60 tecken. */
export function normalizePersonName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) return null;
  return /^\p{L}[\p{L} '’-]*$/u.test(name) ? name : null;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 30);
}

/** fornamn.efternamn@demo.test (testdomän). Tomt efter rensning ger "person". */
export function previewEmailBase(firstName: string, lastName: string): string {
  return `${slug(firstName) || "person"}.${slug(lastName) || "test"}`;
}

export type PreviewProfileResult = {
  userId: string;
  name: string;
  /** Vilka anställningar som var en redan befintlig (importerad) anställning som kontot tog över. */
  adopted: { golfshop: boolean; bollplockare: boolean };
};

/**
 * Skapar förhandsvisningens testprofil från bara för- och efternamn: ETT konto som är administratör OCH
 * anställd i både Golfshop och Bollplockare (med timlön och testschema), så att man kan prova
 * admininloggningen och anställdinloggningen med samma person. Allt markeras isTestData.
 */
export async function createPreviewProfile(
  db: PrismaClient,
  input: { firstName: string; lastName: string; now?: Date; demoData?: boolean },
): Promise<PreviewProfileResult> {
  const demoData = input.demoData ?? true;
  const firstName = normalizePersonName(input.firstName);
  const lastName = normalizePersonName(input.lastName);
  if (!firstName || !lastName) throw new ValidationError("Ange förnamn och efternamn (bara bokstäver).");
  const now = input.now ?? new Date();
  const name = `${firstName} ${lastName}`;

  // Unik e-post även om samma namn skapas flera gånger.
  const base = previewEmailBase(firstName, lastName);
  let email = `${base}@demo.test`;
  for (let n = 2; await db.user.findUnique({ where: { email }, select: { id: true } }); n++) {
    email = `${base}.${n}@demo.test`;
  }

  const year = stockholmYearMonth(now).year;
  const startDate = dateStringToDbDate(`${year}-01-01`);
  // Ingen användbar lösenordshash: kontot nås bara via förhandsvisningen.
  const passwordHash = await hashPassword(randomBytes(24).toString("base64url"));

  const { user, golfshop, bollplockare } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name, passwordHash, role: "ADMIN", isTestData: true } });
    const person = { firstName, lastName, userId: user.id, isTestData: true, employmentStartDate: startDate, showEarningsToEmployee: true };

    // Har det redan importerats en anställning med samma förnamn men utan efternamn (t.ex. från ett utskrivet
    // schema) tar kontot över den i stället för att skapa en dubblett. Dess pass och timlön behålls.
    const employment = async (category: "GOLFSHOP" | "BOLLPLOCKARE") => {
      const existing = await tx.employee.findFirst({
        where: { category, userId: null, lastName: "", firstName: { equals: firstName, mode: "insensitive" } },
      });
      if (existing) {
        const employee = await tx.employee.update({
          where: { id: existing.id },
          data: { userId: user.id, lastName, showEarningsToEmployee: true },
        });
        return { employee, adopted: true };
      }
      return { employee: await tx.employee.create({ data: { ...person, category } }), adopted: false };
    };
    const golfshop = await employment("GOLFSHOP");
    const bollplockare = await employment("BOLLPLOCKARE");
    await writeAudit(tx, {
      actorId: null,
      action: "DEV_PREVIEW_PROFILE_CREATED",
      entityType: "User",
      entityId: user.id,
      metadata: { note: "lokal förhandsvisning, testdata", adopted: [golfshop.adopted, bollplockare.adopted] },
    });
    return { user, golfshop, bollplockare };
  });

  // Skendata (timlön och testpass) bara för nyskapade anställningar och bara om skendata är på.
  if (demoData) {
    const actor = { id: user.id, role: "ADMIN" as const };
    const effectiveFrom = `${year}-01-01`;
    if (!golfshop.adopted) {
      await changeHourlyRate(db, actor, { employeeId: golfshop.employee.id, hourlyRateOre: 15000, effectiveFrom, reason: "Testdata" });
      await createDemoShifts(db, { employeeId: golfshop.employee.id, category: "GOLFSHOP", createdById: user.id, index: 0, now });
    }
    if (!bollplockare.adopted) {
      await changeHourlyRate(db, actor, { employeeId: bollplockare.employee.id, hourlyRateOre: 14000, effectiveFrom, reason: "Testdata" });
      await createDemoShifts(db, { employeeId: bollplockare.employee.id, category: "BOLLPLOCKARE", createdById: user.id, index: 1, now });
    }
  }

  return { userId: user.id, name, adopted: { golfshop: golfshop.adopted, bollplockare: bollplockare.adopted } };
}
