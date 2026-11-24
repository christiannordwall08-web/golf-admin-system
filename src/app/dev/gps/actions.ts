"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { addDaysToDateString, stockholmDateOf } from "@/domain/time";
import { type Pt, offsetPoint } from "@/modules/bollplockare/domain/geo";
import { getSettings, getWorkArea, saveWorkArea, setDayOverride } from "@/modules/bollplockare/server/settings";
import { getDb } from "@/server/db";
import { PREVIEW_COOKIE, findPreviewProfile, isDevPreviewEnabled } from "@/server/dev-preview";
import { createShift } from "@/server/services/shifts";

/**
 * UTVECKLING: verktyg för GPS-simuleringen. Finns bara i lokalt förhandsvisningsläge (DEV_PREVIEW) och kräver testprofilen.
 * Skapar ett FIKTIVT testområde (om inget område ritats) och ett testpass som går att klocka in på just nu.
 * Kan aldrig köras i drift: isDevPreviewEnabled() är falskt där, och hela /dev ger 404.
 */
async function profile() {
  if (!isDevPreviewEnabled()) notFound();
  const p = await findPreviewProfile(getDb(), (await cookies()).get(PREVIEW_COOKIE)?.value);
  if (!p) redirect("/dev");
  return p;
}

export async function createTestAreaAction(): Promise<void> {
  const p = await profile();
  const db = getDb();
  if ((await getWorkArea(db)).configured) redirect("/dev/gps");
  // FIKTIVT område, 400 × 300 m, endast för test. Ersätts när admin ritar det riktiga området.
  const sw: Pt = [59.3293, 18.0686];
  const nw = offsetPoint(sw, 300, 0);
  const ne = offsetPoint(nw, 400, 90);
  const se = offsetPoint(ne, 300, 180);
  await saveWorkArea(db, { id: p.id, role: "ADMIN" }, { polygons: [[sw, nw, ne, se].map((x) => [x[0], x[1]])], marginMeters: 40, expectedVersion: 0 });
  redirect("/dev/gps");
}

export async function createTestShiftAction(): Promise<void> {
  const p = await profile();
  const db = getDb();
  const admin = { id: p.id, role: "ADMIN" as const };
  const employee = await db.employee.findFirst({ where: { userId: p.id, category: "BOLLPLOCKARE", status: "ACTIVE" }, select: { id: true } });
  if (!employee) redirect("/dev/gps?fel=anstallning");
  const now = new Date();
  const today = stockholmDateOf(now);

  // Rangen "stänger" om 15 minuter, så att incheckning (20 min före) är öppen just nu.
  const settings = await getSettings(db);
  const close = new Date(now.getTime() + 15 * 60_000);
  const hh = Number(new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", hour12: false, timeZone: "Europe/Stockholm" }).format(close));
  const mm = new Intl.DateTimeFormat("sv-SE", { minute: "2-digit", timeZone: "Europe/Stockholm" }).format(close).padStart(2, "0");
  const closeTime = hh >= 6 ? `${String(hh).padStart(2, "0")}:${mm}` : "23:59";
  await setDayOverride(db, admin, { date: today, closed: false, closeTime: settings.checkInMarginMinutes >= 15 ? closeTime : "23:59", note: "Testdag (förhandsvisning)" }, now);

  await createShift(db, admin, { employeeId: employee.id, date: today, from: "11:00", to: "15:00", publish: true, confirmWarnings: true, now: new Date(addDaysToDateString(today, -1) + "T12:00:00Z") });
  redirect("/dev/gps?klart=1");
}
