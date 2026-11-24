/**
 * Skapar FÖRSTA administratören (för riktig drift). Kör: npm run db:seed
 * Kräver SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_FIRST_NAME, SEED_ADMIN_LAST_NAME.
 * Gör ingenting om det redan finns en administratör. Skapar ingen testdata.
 */
import "dotenv/config";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { hashPassword, validatePasswordStrength } from "@/server/auth/password";
import { createPrismaClient } from "@/server/db-client";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL saknas.");

  const input = z
    .object({
      SEED_ADMIN_EMAIL: z.email(),
      SEED_ADMIN_PASSWORD: z.string(),
      SEED_ADMIN_FIRST_NAME: z.string().trim().min(1),
      SEED_ADMIN_LAST_NAME: z.string().trim().min(1),
    })
    .safeParse(process.env);
  if (!input.success) {
    console.error(
      "Fyll i SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_FIRST_NAME och SEED_ADMIN_LAST_NAME i .env (se .env.example).",
    );
    process.exit(1);
  }
  const weak = validatePasswordStrength(input.data.SEED_ADMIN_PASSWORD);
  if (weak) {
    console.error(weak);
    process.exit(1);
  }

  const db = createPrismaClient(databaseUrl);
  try {
    if ((await db.user.count({ where: { role: "ADMIN" } })) > 0) {
      console.log("Det finns redan en administratör. Ingen ändring gjord.");
      return;
    }
    const user = await db.user.create({
      data: {
        email: input.data.SEED_ADMIN_EMAIL.toLowerCase(),
        name: `${input.data.SEED_ADMIN_FIRST_NAME} ${input.data.SEED_ADMIN_LAST_NAME}`,
        passwordHash: await hashPassword(input.data.SEED_ADMIN_PASSWORD),
        role: "ADMIN",
      },
    });
    await writeAudit(db, {
      actorId: null,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      metadata: { source: "seed", role: "ADMIN" },
    });
    console.log(`Administratör skapad: ${user.email}`);
    console.log("Ta bort SEED_ADMIN_*-raderna ur .env nu.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
