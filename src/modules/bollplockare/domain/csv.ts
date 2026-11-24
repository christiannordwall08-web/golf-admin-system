/**
 * CSV för löneunderlag, avsett för svensk Excel: semikolon som avgränsare, decimalkomma och UTF-8 med BOM
 * (så att å, ä och ö visas rätt). Celler som börjar med = + - @ eller tabb prefixas så att kalkylprogram aldrig tolkar dem som formler.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? String(value).replace(".", ",") : typeof value === "boolean" ? (value ? "Ja" : "Nej") : value;
  // Skydd mot formelinjektion (namn och anledningar är fri text). Negativa tal skrivs av appen som tal och ska inte prefixas.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (string | number | boolean | null | undefined)[][]): string {
  const lines = [header.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Minuter som timmar med två decimaler och decimalkomma (102 min -> "1,70"). */
export function hoursFromMinutes(minutes: number | null): string {
  return minutes === null ? "" : (minutes / 60).toFixed(2).replace(".", ",");
}
