import { stockholmDateOf, stockholmYearMonth, dateStringToDbDate, localToInstant } from "@/domain/time";
import type { WorkCategory } from "@/domain/roles";
import { type PrismaClient, createPrismaClient } from "@/server/db-client";
import { hashPassword } from "@/server/auth/password";

let client: PrismaClient | undefined;

export function testDb(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL saknas – körs globalSetup?");
  client ??= createPrismaClient(url);
  return client;
}

/** Tömmer alla tabeller (utom Prismas migrationstabell). TRUNCATE kringgår append-only-triggers. */
export async function resetDb(db: PrismaClient = testDb()): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;
const next = () => ++counter;

let cachedHash: string | undefined;
export async function testPasswordHash(): Promise<string> {
  cachedHash ??= await hashPassword("test-password-12345");
  return cachedHash;
}
export const TEST_PASSWORD = "test-password-12345";

export async function makeAdmin(db: PrismaClient = testDb(), name = "Test Admin") {
  return db.user.create({
    data: {
      email: `admin${next()}@test.example`,
      name,
      passwordHash: await testPasswordHash(),
      role: "ADMIN",
      isTestData: true,
    },
  });
}

export async function makeEmployee(
  db: PrismaClient,
  input: { firstName: string; lastName: string; category?: WorkCategory; withUser?: boolean },
) {
  const category = input.category ?? "GOLFSHOP";
  const user =
    input.withUser === false
      ? null
      : await db.user.create({
          data: {
            email: `${input.firstName}.${input.lastName}${next()}@test.example`.toLowerCase(),
            passwordHash: await testPasswordHash(),
            role: category,
            isTestData: true,
          },
        });
  const employee = await db.employee.create({
    data: {
      userId: user?.id,
      firstName: input.firstName,
      lastName: input.lastName,
      category,
      isTestData: true,
    },
  });
  return { user, employee };
}

/** Skapar ett pass med Stockholm-lokala tider, plus månadens schema om det saknas. */
export async function makeShift(
  db: PrismaClient,
  input: {
    employeeId: string;
    createdById: string;
    date: string;
    from: string;
    to: string;
    category?: WorkCategory;
    workStatus?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ABSENT";
    endDate?: string;
  },
) {
  const category = input.category ?? "GOLFSHOP";
  const startsAt = localToInstant(input.date, input.from);
  const endsAt = localToInstant(input.endDate ?? input.date, input.to);
  const { year, month } = stockholmYearMonth(startsAt);
  const schedule = await db.schedule.upsert({
    where: { category_year_month: { category, year, month } },
    create: { category, year, month },
    update: {},
  });
  return db.shift.create({
    data: {
      scheduleId: schedule.id,
      category,
      assignedEmployeeId: input.employeeId,
      originalEmployeeId: input.employeeId,
      startsAt,
      endsAt,
      localDate: dateStringToDbDate(stockholmDateOf(startsAt)),
      workStatus: input.workStatus ?? "SCHEDULED",
      createdById: input.createdById,
    },
  });
}
