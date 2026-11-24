import { timingSafeEqual } from "node:crypto";
import { runBollplockareSweeps } from "@/modules/bollplockare/server/sweeps";
import { getDb } from "@/server/db";

/**
 * Schemalagda kontroller (påminnelser, uteblivna incheckningar, rensning av gamla positioner). Anropas av en cron-tjänst:
 *   curl -X POST -H "Authorization: Bearer $SWEEP_SECRET" https://<adress>/api/internal/sweeps
 * Utan SWEEP_SECRET (minst 24 tecken) är vägen avstängd. Kontrollerna körs även när Admin eller bollplockare öppnar sin panel.
 */
export async function POST(request: Request) {
  const secret = process.env.SWEEP_SECRET;
  if (!secret || secret.length < 24) return new Response("Not found", { status: 404 });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Forbidden", { status: 403 });
  const result = await runBollplockareSweeps(getDb());
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
