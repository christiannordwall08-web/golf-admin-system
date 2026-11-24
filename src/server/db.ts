import "server-only";
import { type PrismaClient, createPrismaClient } from "./db-client";
import { env } from "./env";

const globalForDb = globalThis as unknown as { __golfDb?: PrismaClient };

/** Delad databasklient (en per process, överlever hot reload i utveckling). */
export function getDb(): PrismaClient {
  if (!globalForDb.__golfDb) {
    globalForDb.__golfDb = createPrismaClient(env().DATABASE_URL);
  }
  return globalForDb.__golfDb;
}
