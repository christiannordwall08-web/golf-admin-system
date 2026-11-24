import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

/** Fabrik som även används av seed-skript och databastester (ingen Next.js-koppling). */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Antingen huvudklienten eller en transaktionsklient. Tjänster tar emot denna. */
export type DbClient = PrismaClient | Prisma.TransactionClient;
export type { Prisma, PrismaClient };
