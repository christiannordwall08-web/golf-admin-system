import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL saknas")
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL måste börja med postgresql://"),
  APP_URL: z.url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Externa mejlutskick är AV om inte detta uttryckligen är "true". */
  EMAIL_NOTIFICATIONS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Läser och validerar miljövariabler första gången de behövs (inte vid import/build). */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Ogiltig konfiguration: ${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}
