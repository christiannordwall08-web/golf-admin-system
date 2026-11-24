import "dotenv/config";
import { defineConfig } from "prisma/config";

// Schemat är uppdelat i en fil per område under prisma/schema/ så att flera utvecklare
// kan arbeta parallellt utan att redigera samma fil. Se docs/COLLABORATION.md.
export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  // url krävs bara för migrate/introspect, inte för `prisma generate` (körs vid install).
  datasource: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : undefined,
});
