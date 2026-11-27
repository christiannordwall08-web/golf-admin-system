import { type Eligibility, openShiftEligibility } from "@/domain/open-shifts";
import { type WorkCategory, CATEGORY_HOME, can } from "@/domain/roles";
import { type ShiftIssue, buildShiftInterval } from "@/domain/shifts";
import { dateStringToDbDate, dbDateToString, formatDateLong, formatTimeRange, localToInstant, stockholmDateOf } from "@/domain/time";
import { openEndedWindow } from "@/modules/bollplockare/domain/range-time";
import { getRangeDay } from "@/modules/bollplockare/server/settings";
import { writeAudit } from "@/server/audit";
import type { DbClient, PrismaClient } from "@/server/db-client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { fullName } from "@/server/queries/mappers";
import { adminUserIds, notify } from "./notifications";
import type { Actor } from "./pay-rates";
import { isOverlapViolation, scheduleFor } from "./shifts";

/**
 * LEDIGA PASS (Planday-modellen). Admin lägger ut ett pass utan ansvarig. Behöriga i gruppen får en notis och kan:
 *  - ta passet direkt (autoAssign = först till kvarn), eller
 *  - anmäla intresse, varpå Admin väljer bland anmälningarna.
 * När någon får passet skapas en vanlig Shift i SAMMA transaktion som det lediga passet markeras tillsatt, så två
 * personer kan aldrig få samma pass (optimistisk låsning + unikt index på antagen anmälan + överlappsskydd på Shift).
 *
 * Alla regler för vem som får ta ett pass finns i `openShiftEligibility` (src/domain/open-shifts.ts).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Inställningar
// ---------------------------------------------------------------------------------------------------------------------

export type SchedulingSettingsData = {
  autoApproveSwaps: boolean;
  openShiftAutoAssignDefault: boolean;
};
const DEFAULT_SETTINGS: SchedulingSettingsData = {
  autoApproveSwaps: false,
  openShiftAutoAssignDefault: true,
};

/** Läser inställningarna. Saknas raden gäller standardvärdena (inget skrivs vid läsning). */
export async function getSchedulingSettings(db: DbClient): Promise<SchedulingSettingsData> {
  const row = await db.schedulingSettings.findUnique({
    where: { id: "default" },
  });
  return row
    ? {
        autoApproveSwaps: row.autoApproveSwaps,
        openShiftAutoAssignDefault: row.openShiftAutoAssignDefault,
      }
    : DEFAULT_SETTINGS;
}

export async function updateSchedulingSettings(db: PrismaClient, actor: Actor, input: SchedulingSettingsData): Promise<void> {
  if (!can(actor.role, "settings:scheduling")) throw new ForbiddenError("Endast Admin får ändra inställningarna.");
  await db.$transaction(async (tx) => {
    const before = await getSchedulingSettings(tx);
    await tx.schedulingSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...input, updatedById: actor.id },
      update: { ...input, updatedById: actor.id },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "SCHEDULING_SETTINGS_CHANGED",
      entityType: "SchedulingSettings",
      entityId: "default",
      before,
      after: input,
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------------------------------------------------

const area = (c: WorkCategory) => CATEGORY_HOME[c];
const employeeLink = (c: WorkCategory) => `${area(c)}/lediga-pass`;
const adminLink = (id: string) => `/admin/lediga-pass/${id}`;

type OpenShiftLike = {
  id: string;
  category: WorkCategory;
  localDate: Date;
  startsAt: Date;
  endsAt: Date;
  openEnded: boolean;
};
/** "lördag 6 december 11.00–15.00" (pass utan fast sluttid: bara dagen). */
export function openShiftLabel(s: Pick<OpenShiftLike, "localDate" | "startsAt" | "endsAt" | "openEnded">): string {
  const day = formatDateLong(localToInstant(dbDateToString(s.localDate), "12:00"));
  return s.openEnded ? `${day} (till plockningen är klar)` : `${day} ${formatTimeRange(s.startsAt, s.endsAt)}`;
}

async function shiftsThatMayClash(db: DbClient, employeeIds: readonly string[], startsAt: Date, endsAt: Date) {
  if (employeeIds.length === 0) return [];
  return db.shift.findMany({
    where: {
      assignedEmployeeId: { in: [...employeeIds] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      workStatus: { not: "CANCELLED" },
    },
    select: {
      assignedEmployeeId: true,
      startsAt: true,
      endsAt: true,
      workStatus: true,
    },
  });
}

/** Aktiva anställda i gruppen (med inloggning) som får ta passet just nu. Används för notiser. */
export async function eligibleRecipients(
  db: DbClient,
  os: Pick<OpenShiftLike, "category" | "startsAt" | "endsAt">,
  now: Date,
  excludeEmployeeIds: readonly string[] = [],
) {
  const group = await db.employee.findMany({
    where: {
      category: os.category,
      status: "ACTIVE",
      userId: { not: null },
      id: { notIn: [...excludeEmployeeIds] },
    },
    select: { id: true, userId: true, category: true, status: true },
  });
  const clashes = await shiftsThatMayClash(
    db,
    group.map((g) => g.id),
    os.startsAt,
    os.endsAt,
  );
  return group.filter(
    (e) =>
      openShiftEligibility({
        openShift: { ...os, status: "OPEN" },
        employee: e,
        otherShifts: clashes.filter((c) => c.assignedEmployeeId === e.id),
        now,
      }).eligible,
  );
}

async function myEmployee(db: DbClient, actor: Actor, category: WorkCategory) {
  if (!can(actor.role, "openshift:claim")) throw new ForbiddenError();
  const e = await db.employee.findFirst({
    where: { userId: actor.id, category },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      category: true,
      status: true,
      userId: true,
    },
  });
  if (!e) throw new ForbiddenError("Du har ingen anställning i den här gruppen.");
  return e;
}

async function eligibilityFor(
  db: DbClient,
  os: OpenShiftLike & { status: "OPEN" | "FILLED" | "CANCELLED" },
  employee: {
    id: string;
    category: WorkCategory;
    status: "ACTIVE" | "INACTIVE";
  },
  now: Date,
): Promise<Eligibility> {
  const others = await shiftsThatMayClash(db, [employee.id], os.startsAt, os.endsAt);
  return openShiftEligibility({
    openShift: os,
    employee,
    otherShifts: others,
    now,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Admin: lägga ut, välja, dra in
// ---------------------------------------------------------------------------------------------------------------------

export type CreateOpenShiftInput = {
  category: WorkCategory;
  /** Stockholm-datum "YYYY-MM-DD". */
  date: string;
  /** "HH:mm". Ignoreras för bollplockare (passet utgår från rangens stängningstid). */
  from?: string;
  to?: string;
  endsNextDay?: boolean;
  notes?: string | null;
  /** Utelämnat = Admins förval i inställningarna. */
  autoAssign?: boolean;
  now?: Date;
};

export type CreateOpenShiftResult = { ok: true; id: string; notified: number } | { ok: false; issues: ShiftIssue[] };

export async function createOpenShift(db: PrismaClient, actor: Actor, input: CreateOpenShiftInput): Promise<CreateOpenShiftResult> {
  if (!can(actor.role, "openshift:manage")) throw new ForbiddenError("Endast Admin får lägga ut lediga pass.");
  const now = input.now ?? new Date();
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 200)
    return {
      ok: false,
      issues: [
        {
          code: "INVALID_TIMES",
          severity: "error",
          message: "Noteringen får vara högst 200 tecken.",
        },
      ],
    };

  const openEnded = input.category === "BOLLPLOCKARE";
  let startsAt: Date;
  let endsAt: Date;
  if (openEnded) {
    const window = openEndedWindow(await getRangeDay(db, input.date));
    if (!window)
      return {
        ok: false,
        issues: [
          {
            code: "INVALID_TIMES",
            severity: "error",
            message: "Rangen är stängd den dagen.",
          },
        ],
      };
    ({ startsAt, endsAt } = window);
  } else {
    const interval = buildShiftInterval({
      date: input.date,
      from: input.from ?? "",
      to: input.to ?? "",
      endsNextDay: input.endsNextDay,
    });
    if (!interval.ok) return { ok: false, issues: [interval.issue] };
    ({ startsAt, endsAt } = interval);
  }
  if (startsAt <= now)
    return {
      ok: false,
      issues: [
        {
          code: "ALREADY_ENDED",
          severity: "error",
          message: "Ett ledigt pass måste ligga i framtiden.",
        },
      ],
    };

  const autoAssign = input.autoAssign ?? (await getSchedulingSettings(db)).openShiftAutoAssignDefault;
  return db.$transaction(async (tx) => {
    const os = await tx.openShift.create({
      data: {
        category: input.category,
        startsAt,
        endsAt,
        localDate: dateStringToDbDate(openEnded ? input.date : stockholmDateOf(startsAt)),
        openEnded,
        notes,
        autoAssign,
        createdById: actor.id,
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "OPEN_SHIFT_CREATED",
      entityType: "OpenShift",
      entityId: os.id,
      after: {
        category: os.category,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        autoAssign,
      },
    });
    const recipients = await eligibleRecipients(tx, os, now);
    const notified = await notify(tx, {
      userIds: recipients.flatMap((r) => (r.userId ? [r.userId] : [])),
      type: "OPEN_SHIFT_POSTED",
      title: `Ledigt pass: ${openShiftLabel(os)}`,
      body: [autoAssign ? "Först till kvarn." : "Anmäl intresse, admin väljer.", notes].filter(Boolean).join(" "),
      linkPath: employeeLink(os.category),
      entityType: "OpenShift",
      entityId: os.id,
    });
    return { ok: true as const, id: os.id, notified };
  });
}

/** Admin väljer en intresseanmälan. */
export async function assignOpenShift(db: PrismaClient, actor: Actor, openShiftId: string, claimId: string, now = new Date()): Promise<{ shiftId: string }> {
  if (!can(actor.role, "openshift:manage")) throw new ForbiddenError("Endast Admin får tillsätta lediga pass.");
  const os = await db.openShift.findUnique({ where: { id: openShiftId } });
  if (!os) throw new NotFoundError("Det lediga passet finns inte.");
  const claim = await db.openShiftClaim.findUnique({
    where: { id: claimId },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          category: true,
          status: true,
          userId: true,
        },
      },
    },
  });
  if (!claim || claim.openShiftId !== os.id) throw new NotFoundError("Anmälan finns inte.");
  if (claim.status !== "PENDING") throw new ConflictError("Anmälan är inte längre aktiv.");
  const elig = await eligibilityFor(db, os, claim.employee, now);
  if (!elig.eligible) throw new ValidationError(elig.reason === "OVERLAP" ? "Personen har fått ett pass som krockar." : elig.message);
  return fill(db, os, claim.employee, actor.id, now, false);
}

export async function cancelOpenShift(db: PrismaClient, actor: Actor, openShiftId: string, reason: string, now = new Date()): Promise<void> {
  if (!can(actor.role, "openshift:manage")) throw new ForbiddenError("Endast Admin får dra in lediga pass.");
  const text = reason.trim();
  if (text.length < 3) throw new ValidationError("Skriv en kort anledning.");
  const os = await db.openShift.findUnique({ where: { id: openShiftId } });
  if (!os) throw new NotFoundError("Det lediga passet finns inte.");
  if (os.status !== "OPEN") throw new ConflictError("Passet är redan tillsatt eller indraget.");
  await db.$transaction(async (tx) => {
    const { count } = await tx.openShift.updateMany({
      where: { id: os.id, version: os.version, status: "OPEN" },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledById: actor.id,
        cancelReason: text.slice(0, 300),
        version: { increment: 1 },
      },
    });
    if (count === 0) throw new ConflictError("Passet ändrades just nu. Ladda om sidan.");
    const pending = await tx.openShiftClaim.findMany({
      where: { openShiftId: os.id, status: "PENDING" },
      select: { id: true, employee: { select: { userId: true } } },
    });
    await tx.openShiftClaim.updateMany({
      where: { openShiftId: os.id, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: now, decidedById: actor.id },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "OPEN_SHIFT_CANCELLED",
      entityType: "OpenShift",
      entityId: os.id,
      metadata: { reason: text, pendingClaims: pending.length },
    });
    await notify(tx, {
      userIds: pending.flatMap((p) => (p.employee.userId ? [p.employee.userId] : [])),
      type: "OPEN_SHIFT_CANCELLED",
      title: `Det lediga passet ${openShiftLabel(os)} är indraget`,
      body: text,
      linkPath: employeeLink(os.category),
      entityType: "OpenShift",
      entityId: os.id,
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Personal: ta, anmäla intresse, återkalla
// ---------------------------------------------------------------------------------------------------------------------

export type ClaimResult = { assigned: true; shiftId: string } | { assigned: false };

/** Först till kvarn: man får passet direkt. Annars sparas en intresseanmälan och Admin får en notis. */
export async function claimOpenShift(db: PrismaClient, actor: Actor, openShiftId: string, now = new Date()): Promise<ClaimResult> {
  const os = await db.openShift.findUnique({ where: { id: openShiftId } });
  if (!os) throw new NotFoundError("Det lediga passet finns inte.");
  const me = await myEmployee(db, actor, os.category);
  const elig = await eligibilityFor(db, os, me, now);
  if (!elig.eligible)
    throw elig.reason === "NOT_OPEN" ? new ConflictError("Någon annan hann före, eller passet är indraget.") : new ValidationError(elig.message);

  if (os.autoAssign) {
    const { shiftId } = await fill(db, os, me, actor.id, now, true);
    return { assigned: true, shiftId };
  }

  await db.$transaction(async (tx) => {
    const existing = await tx.openShiftClaim.findUnique({
      where: {
        openShiftId_employeeId: { openShiftId: os.id, employeeId: me.id },
      },
    });
    if (existing?.status === "PENDING") return; // redan anmäld: idempotent
    if (existing && existing.status !== "WITHDRAWN") throw new ConflictError("Du har redan fått besked om det här passet.");
    if (existing)
      await tx.openShiftClaim.update({
        where: { id: existing.id },
        data: { status: "PENDING", decidedAt: null, decidedById: null },
      });
    else
      await tx.openShiftClaim.create({
        data: { openShiftId: os.id, employeeId: me.id },
      });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "OPEN_SHIFT_CLAIMED",
      entityType: "OpenShift",
      entityId: os.id,
      after: { employeeId: me.id },
    });
    await notify(tx, {
      userIds: await adminUserIds(tx),
      type: "OPEN_SHIFT_CLAIMED",
      title: `${fullName(me)} vill ta det lediga passet ${openShiftLabel(os)}`,
      body: "Välj vem som får passet.",
      linkPath: adminLink(os.id),
      entityType: "OpenShift",
      entityId: os.id,
    });
  });
  return { assigned: false };
}

export async function withdrawClaim(db: PrismaClient, actor: Actor, openShiftId: string): Promise<void> {
  const os = await db.openShift.findUnique({ where: { id: openShiftId } });
  if (!os) throw new NotFoundError("Det lediga passet finns inte.");
  const me = await myEmployee(db, actor, os.category);
  await db.$transaction(async (tx) => {
    const { count } = await tx.openShiftClaim.updateMany({
      where: { openShiftId: os.id, employeeId: me.id, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
    if (count === 0) throw new ConflictError("Du har ingen aktiv anmälan på passet.");
    await writeAudit(tx, {
      actorId: actor.id,
      action: "OPEN_SHIFT_CLAIM_WITHDRAWN",
      entityType: "OpenShift",
      entityId: os.id,
      after: { employeeId: me.id },
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Tillsättning (en transaktion)
// ---------------------------------------------------------------------------------------------------------------------

type FillEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  category: WorkCategory;
  userId: string | null;
};
type FillOpenShift = OpenShiftLike & {
  version: number;
  notes: string | null;
  createdById: string;
};

async function fill(db: PrismaClient, os: FillOpenShift, employee: FillEmployee, actorUserId: string, now: Date, auto: boolean): Promise<{ shiftId: string }> {
  try {
    return await db.$transaction(async (tx) => {
      const schedule = await scheduleFor(tx, os.category, os.startsAt);
      // Den anställda valde själv passet: det räknas som godkänt av hen från början.
      const shift = await tx.shift.create({
        data: {
          scheduleId: schedule.id,
          category: os.category,
          assignedEmployeeId: employee.id,
          originalEmployeeId: employee.id,
          startsAt: os.startsAt,
          endsAt: os.endsAt,
          localDate: os.localDate,
          publicationStatus: "PUBLISHED",
          approvalStatus: "APPROVED",
          openEnded: os.openEnded,
          notes: os.notes,
          createdById: os.createdById,
        },
      });
      await tx.shiftAssignmentHistory.create({
        data: {
          shiftId: shift.id,
          toEmployeeId: employee.id,
          reason: "OPEN_SHIFT",
          changedById: actorUserId,
          comment: auto ? "Tog ett ledigt pass (först till kvarn)" : "Valdes till ett ledigt pass",
        },
      });
      await tx.shiftApproval.create({
        data: {
          shiftId: shift.id,
          employeeId: employee.id,
          shiftVersion: shift.version,
          decision: "APPROVED",
          comment: "Ledigt pass",
        },
      });

      // Låset: bara om passet fortfarande är ledigt och oförändrat. Annars rullas allt ovan tillbaka.
      const { count } = await tx.openShift.updateMany({
        where: { id: os.id, version: os.version, status: "OPEN" },
        data: {
          status: "FILLED",
          filledShiftId: shift.id,
          filledAt: now,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw new ConflictError("Någon annan hann före, eller passet ändrades just nu.");

      await tx.openShiftClaim.upsert({
        where: {
          openShiftId_employeeId: {
            openShiftId: os.id,
            employeeId: employee.id,
          },
        },
        create: {
          openShiftId: os.id,
          employeeId: employee.id,
          status: "ACCEPTED",
          decidedAt: now,
          decidedById: actorUserId,
        },
        update: {
          status: "ACCEPTED",
          decidedAt: now,
          decidedById: actorUserId,
        },
      });
      const others = await tx.openShiftClaim.findMany({
        where: { openShiftId: os.id, status: "PENDING" },
        select: { employee: { select: { userId: true } } },
      });
      await tx.openShiftClaim.updateMany({
        where: { openShiftId: os.id, status: "PENDING" },
        data: { status: "REJECTED", decidedAt: now, decidedById: actorUserId },
      });

      await writeAudit(tx, {
        actorId: actorUserId,
        action: "OPEN_SHIFT_FILLED",
        entityType: "OpenShift",
        entityId: os.id,
        after: { shiftId: shift.id, employeeId: employee.id, auto },
      });

      const label = openShiftLabel(os);
      const schedulePath = `${area(os.category)}/schema`;
      if (employee.userId) {
        await notify(tx, {
          userIds: [employee.userId],
          type: "OPEN_SHIFT_ASSIGNED",
          title: `Du har fått passet ${label}`,
          body: "Passet ligger nu i ditt schema.",
          linkPath: schedulePath,
          entityType: "Shift",
          entityId: shift.id,
        });
      }
      await notify(tx, {
        userIds: others.flatMap((o) => (o.employee.userId ? [o.employee.userId] : [])),
        type: "OPEN_SHIFT_NOT_ASSIGNED",
        title: `Det lediga passet ${label} gick till någon annan`,
        body: "Tack för att du anmälde dig.",
        linkPath: employeeLink(os.category),
        entityType: "OpenShift",
        entityId: os.id,
      });
      if (auto) {
        await notify(tx, {
          userIds: await adminUserIds(tx),
          type: "OPEN_SHIFT_CLAIMED",
          title: `${fullName(employee)} tog det lediga passet ${label}`,
          body: "Tillsatt automatiskt (först till kvarn).",
          linkPath: adminLink(os.id),
          entityType: "OpenShift",
          entityId: os.id,
        });
      }
      return { shiftId: shift.id };
    });
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("Personen har redan ett pass som krockar med det här.");
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Läsning
// ---------------------------------------------------------------------------------------------------------------------

export type AdminOpenShiftRow = {
  id: string;
  category: WorkCategory;
  label: string;
  date: string;
  status: "OPEN" | "FILLED" | "CANCELLED";
  autoAssign: boolean;
  notes: string | null;
  pendingClaims: number;
  filledBy: string | null;
  startsAt: Date;
};

export async function listOpenShiftsForAdmin(db: DbClient, actor: Actor, opts: { includeClosedDays?: number; now?: Date } = {}): Promise<AdminOpenShiftRow[]> {
  if (!can(actor.role, "openshift:manage")) throw new ForbiddenError();
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.includeClosedDays ?? 30) * 86_400_000);
  const rows = await db.openShift.findMany({
    where: { OR: [{ status: "OPEN" }, { updatedAt: { gte: since } }] },
    include: {
      claims: { where: { status: "PENDING" }, select: { id: true } },
      filledShift: {
        select: {
          assignedEmployee: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { startsAt: "asc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    label: openShiftLabel(r),
    date: dbDateToString(r.localDate),
    status: r.status,
    autoAssign: r.autoAssign,
    notes: r.notes,
    pendingClaims: r.claims.length,
    filledBy: r.filledShift ? fullName(r.filledShift.assignedEmployee) : null,
    startsAt: r.startsAt,
  }));
}

export async function getOpenShiftForAdmin(db: DbClient, actor: Actor, id: string, now = new Date()) {
  if (!can(actor.role, "openshift:manage")) throw new ForbiddenError();
  const os = await db.openShift.findUnique({
    where: { id },
    include: {
      claims: {
        orderBy: { createdAt: "asc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              category: true,
              status: true,
            },
          },
        },
      },
      filledShift: {
        select: {
          id: true,
          assignedEmployee: { select: { firstName: true, lastName: true } },
        },
      },
      cancelledBy: { select: { name: true } },
    },
  });
  if (!os) throw new NotFoundError("Det lediga passet finns inte.");
  const clashes = await shiftsThatMayClash(
    db,
    os.claims.map((c) => c.employee.id),
    os.startsAt,
    os.endsAt,
  );
  return {
    id: os.id,
    category: os.category,
    label: openShiftLabel(os),
    status: os.status,
    autoAssign: os.autoAssign,
    notes: os.notes,
    filledBy: os.filledShift ? fullName(os.filledShift.assignedEmployee) : null,
    cancelReason: os.cancelReason,
    claims: os.claims.map((c) => {
      const elig = openShiftEligibility({
        openShift: os,
        employee: c.employee,
        otherShifts: clashes.filter((x) => x.assignedEmployeeId === c.employee.id),
        now,
      });
      return {
        id: c.id,
        name: fullName(c.employee),
        status: c.status,
        at: c.createdAt,
        blockedBy: c.status === "PENDING" && !elig.eligible ? elig.message : null,
      };
    }),
  };
}

export type EmployeeOpenShiftRow = {
  id: string;
  label: string;
  date: string;
  /** "11.00–15.00", eller null för pass utan fast sluttid (bollplockare). */
  time: string | null;
  autoAssign: boolean;
  notes: string | null;
  myClaim: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | null;
  /** null = du kan ta passet. Annars varför inte (t.ex. krock). */
  blockedBy: string | null;
};

/** Lediga pass i gruppen som ännu inte börjat, med den inloggades status. Bara egna uppgifter visas. */
export async function listOpenShiftsForEmployee(db: DbClient, actor: Actor, category: WorkCategory, now = new Date()): Promise<EmployeeOpenShiftRow[]> {
  const me = await myEmployee(db, actor, category);
  const rows = await db.openShift.findMany({
    where: { category, status: "OPEN", startsAt: { gt: now } },
    include: {
      claims: { where: { employeeId: me.id }, select: { status: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 100,
  });
  const from = rows[0]?.startsAt;
  const to = rows.reduce<Date | undefined>((m, r) => (!m || r.endsAt > m ? r.endsAt : m), undefined);
  const mine = from && to ? await shiftsThatMayClash(db, [me.id], from, to) : [];
  return rows.map((r) => {
    const elig = openShiftEligibility({
      openShift: r,
      employee: me,
      otherShifts: mine,
      now,
    });
    return {
      id: r.id,
      label: openShiftLabel(r),
      date: dbDateToString(r.localDate),
      time: r.openEnded ? null : formatTimeRange(r.startsAt, r.endsAt),
      autoAssign: r.autoAssign,
      notes: r.notes,
      myClaim: r.claims[0]?.status ?? null,
      blockedBy: elig.eligible ? null : elig.message,
    };
  });
}

/** Antal lediga pass som den inloggade kan ta just nu (för startsidan och menyn). */
export async function countOpenShiftsICanTake(db: DbClient, actor: Actor, category: WorkCategory, now = new Date()): Promise<number> {
  const rows = await listOpenShiftsForEmployee(db, actor, category, now).catch(() => []);
  return rows.filter((r) => !r.blockedBy && r.myClaim !== "PENDING").length;
}
