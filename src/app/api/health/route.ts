import { getDb } from "@/server/db";

/** Driftkontroll (t.ex. för hosting-plattformen). Avslöjar aldrig detaljer. */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers });
  } catch {
    return Response.json({ status: "error" }, { status: 503, headers });
  }
}
