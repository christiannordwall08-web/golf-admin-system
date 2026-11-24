import { createHash, randomUUID } from "node:crypto";
import { monthParam, shiftMonth } from "@/domain/calendar";
import {
  MAX_CLOSING_IMAGE_BYTES,
  MAX_DAY_TOTAL_ORE,
  closingStorageKey,
  detectImage,
  isAllowedClosingDate,
} from "@/domain/daily-closing";
import { formatSek } from "@/domain/money";
import { type UserRole, can } from "@/domain/roles";
import { dateStringToDbDate, dbDateToString, monthBounds, stockholmDateOf } from "@/domain/time";
import { writeAudit } from "@/server/audit";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { fullName } from "@/server/queries/mappers";
import type { FileStorage } from "@/server/storage/file-storage";
import { closingRecipientIds, notify } from "./notifications";

/**
 * Dagsavslut: golfshopens personal tar en bild på dagens avslut och skickar in den tillsammans med dagens summa.
 * Bilden hamnar i skyddad lagring (aldrig publik URL), metadata i databasen, och administratörerna som tar emot
 * dagsavslut får en notis direkt. Det syns alltid NÄR och VEM som skickade in.
 */
export type Actor = { id: string; role: UserRole };

export type SubmitClosingInput = {
  /** Stockholm-datum (YYYY-MM-DD) som avslutet gäller. */
  workDate: string;
  /** Dagens summa i ören. */
  dayTotalOre: number;
  note?: string | null;
  bytes: Uint8Array;
  originalName?: string | null;
  now?: Date;
};

export async function submitDailyClosing(
  db: PrismaClient,
  storage: FileStorage,
  actor: Actor,
  input: SubmitClosingInput,
): Promise<{ id: string }> {
  if (!can(actor.role, "dailyclosing:submit")) throw new ForbiddenError("Bara personal i golfshopen kan skicka in dagsavslut.");
  const now = input.now ?? new Date();

  // Den som skickar in är alltid den inloggade personens golfshop-anställning (aldrig ett id från formuläret).
  const employee = await db.employee.findFirst({
    where: { userId: actor.id, category: "GOLFSHOP", status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!employee) throw new ForbiddenError("Du har ingen aktiv anställning i golfshopen.");

  if (!isAllowedClosingDate(input.workDate, stockholmDateOf(now))) {
    throw new ValidationError("Dagsavslutet kan gälla idag eller de senaste dagarna, inte framåt i tiden.");
  }
  if (!Number.isSafeInteger(input.dayTotalOre) || input.dayTotalOre < 0 || input.dayTotalOre > MAX_DAY_TOTAL_ORE) {
    throw new ValidationError("Dagens summa är ogiltig.");
  }
  const note = input.note?.trim() || null;
  if (note && note.length > 500) throw new ValidationError("Kommentaren får vara högst 500 tecken.");

  if (input.bytes.length === 0) throw new ValidationError("Välj en bild att skicka in.");
  if (input.bytes.length > MAX_CLOSING_IMAGE_BYTES) throw new ValidationError("Bilden är för stor (högst 10 MB).");
  const kind = detectImage(input.bytes);
  if (!kind) throw new ValidationError("Filen är ingen bild som kan användas. Skicka en foto (JPEG, PNG eller WebP).");

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const workDate = dateStringToDbDate(input.workDate);
  if (await db.dailyClosing.findFirst({ where: { workDate, sha256 }, select: { id: true } })) {
    throw new ValidationError("Den här bilden har redan skickats in för dagen.");
  }

  const key = closingStorageKey(input.workDate, randomUUID(), kind.ext);
  await storage.put(key, input.bytes);
  try {
    return await db.$transaction(async (tx) => {
      const closing = await tx.dailyClosing.create({
        data: {
          workDate,
          uploadedByEmployeeId: employee.id,
          storageKey: key,
          originalFilename: input.originalName?.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || null,
          mimeType: kind.mime,
          sizeBytes: input.bytes.length,
          sha256,
          dayTotalOre: input.dayTotalOre,
          note,
          uploadedAt: now,
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "DAILY_CLOSING_SUBMITTED",
        entityType: "DailyClosing",
        entityId: closing.id,
        after: { workDate: input.workDate, dayTotalOre: input.dayTotalOre, sizeBytes: input.bytes.length, mime: kind.mime },
      });
      await notify(tx, {
        userIds: await closingRecipientIds(tx),
        type: "DAILY_CLOSING_SUBMITTED",
        title: `Dagsavslut ${input.workDate} från ${fullName(employee)}`,
        body: `Dagens summa: ${formatSek(input.dayTotalOre)}`,
        linkPath: `/admin/dagsavslut?datum=${input.workDate}`,
        entityType: "DailyClosing",
        entityId: closing.id,
      });
      return { id: closing.id };
    });
  } catch (e) {
    await storage.delete(key).catch(() => undefined); // ingen föräldralös fil om databasen sa nej
    throw e;
  }
}

export type ClosingRow = {
  id: string;
  workDate: string;
  uploadedAt: Date;
  employeeName: string;
  dayTotalOre: number;
  note: string | null;
  status: "SUBMITTED" | "REVIEWED";
  reviewedAt: Date | null;
  reviewedByName: string | null;
  sizeBytes: number;
};

export type ClosingDay = {
  date: string;
  closings: ClosingRow[];
  /** Dagens summa = den senast inskickade (en ny inskickning ersätter, den läggs inte ovanpå). */
  dayTotalOre: number;
};

export type ClosingsMonth = {
  days: ClosingDay[];
  /** Passerade dagar i månaden då golfshopen hade pass men inget avslut skickats in. */
  missingDates: string[];
  monthTotalOre: number;
  newCount: number;
};

const closingSelect = {
  id: true,
  workDate: true,
  uploadedAt: true,
  dayTotalOre: true,
  note: true,
  status: true,
  reviewedAt: true,
  sizeBytes: true,
  uploadedBy: { select: { firstName: true, lastName: true } },
  reviewedBy: { select: { name: true, email: true } },
} as const;

function toRow(r: {
  id: string;
  workDate: Date;
  uploadedAt: Date;
  dayTotalOre: number;
  note: string | null;
  status: "SUBMITTED" | "REVIEWED";
  reviewedAt: Date | null;
  sizeBytes: number;
  uploadedBy: { firstName: string; lastName: string };
  reviewedBy: { name: string | null; email: string } | null;
}): ClosingRow {
  return {
    id: r.id,
    workDate: dbDateToString(r.workDate),
    uploadedAt: r.uploadedAt,
    employeeName: fullName(r.uploadedBy),
    dayTotalOre: r.dayTotalOre,
    note: r.note,
    status: r.status,
    reviewedAt: r.reviewedAt,
    reviewedByName: r.reviewedBy ? (r.reviewedBy.name ?? r.reviewedBy.email) : null,
    sizeBytes: r.sizeBytes,
  };
}

/** Administratörens vy över en månad: alla avslut grupperade per dag, med vem och när, samt saknade dagar. */
export async function getClosingsMonth(
  db: DbClient,
  actor: Actor,
  input: { year: number; month: number; now?: Date },
): Promise<ClosingsMonth> {
  if (!can(actor.role, "dailyclosing:read:all")) throw new ForbiddenError();
  const now = input.now ?? new Date();
  const { start, end } = monthBounds(input.year, input.month);
  // workDate är en ren DATUM-kolumn: jämför med datum (inte med månadsgränsens tidpunkt, som är 22.00/23.00 UTC dagen före).
  const next = shiftMonth(input, 1);
  const first = dateStringToDbDate(`${monthParam(input)}-01`);
  const firstOfNext = dateStringToDbDate(`${monthParam(next)}-01`);
  const rows = await db.dailyClosing.findMany({
    where: { workDate: { gte: first, lt: firstOfNext } },
    select: closingSelect,
    orderBy: [{ workDate: "desc" }, { uploadedAt: "desc" }],
  });
  const byDate = new Map<string, ClosingRow[]>();
  for (const r of rows.map(toRow)) byDate.set(r.workDate, [...(byDate.get(r.workDate) ?? []), r]);
  const days: ClosingDay[] = [...byDate.entries()].map(([date, closings]) => ({ date, closings, dayTotalOre: closings[0].dayTotalOre }));

  const today = stockholmDateOf(now);
  const golfshopDays = await db.shift.findMany({
    where: { category: "GOLFSHOP", workStatus: { not: "CANCELLED" }, publicationStatus: "PUBLISHED", startsAt: { gte: start, lt: end } },
    select: { localDate: true },
    distinct: ["localDate"],
  });
  const missingDates = golfshopDays
    .map((s) => dbDateToString(s.localDate))
    .filter((d) => d < today && !byDate.has(d))
    .sort();

  return {
    days,
    missingDates,
    monthTotalOre: days.reduce((n, d) => n + d.dayTotalOre, 0),
    newCount: rows.filter((r) => r.status === "SUBMITTED").length,
  };
}

/** Dagens summa för ett datum (för översikten), eller null om inget skickats in. */
export async function getClosingForDate(db: DbClient, actor: Actor, date: string): Promise<{ dayTotalOre: number; count: number } | null> {
  if (!can(actor.role, "dailyclosing:read:all")) throw new ForbiddenError();
  const rows = await db.dailyClosing.findMany({ where: { workDate: dateStringToDbDate(date) }, orderBy: { uploadedAt: "desc" }, select: { dayTotalOre: true } });
  return rows.length ? { dayTotalOre: rows[0].dayTotalOre, count: rows.length } : null;
}

/** Den inloggade personalens egna inskickade avslut (bara sina egna). */
export async function listMyClosings(db: DbClient, userId: string, limit = 15): Promise<ClosingRow[]> {
  const rows = await db.dailyClosing.findMany({
    where: { uploadedBy: { userId } },
    select: closingSelect,
    orderBy: { uploadedAt: "desc" },
    take: limit,
  });
  return rows.map(toRow);
}

/** Bilden. Administratörer (som får läsa alla avslut) och personen som skickade in den får se den, ingen annan. */
export async function readClosingImage(
  db: DbClient,
  storage: FileStorage,
  actor: Actor,
  id: string,
): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
  const c = await db.dailyClosing.findUnique({
    where: { id },
    select: { storageKey: true, mimeType: true, workDate: true, uploadedBy: { select: { userId: true } } },
  });
  const allowed = c && (can(actor.role, "dailyclosing:read:all") || c.uploadedBy.userId === actor.id);
  if (!c || !allowed) throw new NotFoundError("Bilden finns inte."); // samma svar oavsett: avslöjar inte att den finns
  const ext = c.mimeType === "image/png" ? "png" : c.mimeType === "image/webp" ? "webp" : "jpg";
  return { bytes: await storage.get(c.storageKey), mimeType: c.mimeType, filename: `dagsavslut-${dbDateToString(c.workDate)}.${ext}` };
}

/** Administratören markerar ett avslut som granskat. Idempotent. */
export async function markClosingReviewed(db: PrismaClient, actor: Actor, id: string, now = new Date()): Promise<void> {
  if (!can(actor.role, "dailyclosing:read:all")) throw new ForbiddenError();
  await db.$transaction(async (tx) => {
    const c = await tx.dailyClosing.findUnique({ where: { id }, select: { status: true } });
    if (!c) throw new NotFoundError("Dagsavslutet finns inte.");
    if (c.status === "REVIEWED") return;
    await tx.dailyClosing.update({ where: { id }, data: { status: "REVIEWED", reviewedAt: now, reviewedById: actor.id } });
    await writeAudit(tx, { actorId: actor.id, action: "DAILY_CLOSING_REVIEWED", entityType: "DailyClosing", entityId: id });
  });
}
