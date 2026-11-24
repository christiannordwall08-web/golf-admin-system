import { type NextRequest } from "next/server";
import { monthParam, parseMonthParam, shiftMonth } from "@/domain/calendar";
import { can } from "@/domain/roles";
import { addDaysToDateString } from "@/domain/time";
import { listWorkEntries, workEntriesToCsv } from "@/modules/bollplockare/server/reports";
import { getSessionUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

/** Löneunderlag som CSV (en rad per arbetspass, namn på varje rad). Kräver adminsession och behörighet; ingen cachelagring. */
export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return new Response("Inte inloggad", { status: 401 });
  if (session.context !== "ADMIN" || !can(session.user.actingRole, "worktime:read:all")) return new Response("Saknar behörighet", { status: 403 });
  const sp = request.nextUrl.searchParams;
  const ym = parseMonthParam(sp.get("m") ?? undefined, new Date());
  const first = `${monthParam(ym)}-01`;
  const last = addDaysToDateString(`${monthParam(shiftMonth(ym, 1))}-01`, -1);
  const statusParam = sp.get("status");
  const status = statusParam === "NEEDS_REVIEW" || statusParam === "PRELIMINARY" || statusParam === "APPROVED" ? statusParam : "ALL";
  const anstalld = sp.get("anstalld");
  const rows = await listWorkEntries(getDb(), { id: session.user.id, role: session.user.actingRole }, {
    from: first, to: last, status,
    employeeId: anstalld && /^[a-z0-9]{10,40}$/i.test(anstalld) ? anstalld : undefined,
    category: sp.get("kat") === "bollplockare" ? "BOLLPLOCKARE" : null,
  });
  return new Response(workEntriesToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="loneunderlag-${monthParam(ym)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
