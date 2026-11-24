import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Fabrik som även används av seed-skript och databastester (ingen Next.js-koppling).
 *
 * VIKTIGT: sessionens tidszon tvingas till UTC. Prismas drivrutin skickar och läser tidsstämplar utan
 * tidszon, och Postgres tolkar dem i SESSIONENS tidszon. Är databasens standardtidszon något annat än UTC
 * (t.ex. Europe/Stockholm på en utvecklingsdator) lagras alla tidpunkter fel (en eller två timmar), och
 * triggers som jämför med now() får fel. Med UTC är lagring och läsning korrekt oavsett databasens inställning.
 * Presentation i Europe/Stockholm sker i appen (src/domain/time.ts), aldrig i databasen.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, options: "-c TimeZone=UTC" }) });
}

/** Antingen huvudklienten eller en transaktionsklient. Tjänster tar emot denna. */
export type DbClient = PrismaClient | Prisma.TransactionClient;
export type { Prisma, PrismaClient };
