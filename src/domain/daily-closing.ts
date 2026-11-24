import { kronorToOre } from "./money";
import { addDaysToDateString } from "./time";

/** Största tillåtna bild (efter att telefonen komprimerat den). */
export const MAX_CLOSING_IMAGE_BYTES = 10 * 1024 * 1024;
/** Högsta dagssumma som godtas (skydd mot skrivfel). 10 miljoner kr. */
export const MAX_DAY_TOTAL_ORE = 1_000_000_000;
/** Ett avslut kan skickas in för idag och några dagar bakåt (om det glömdes), aldrig framåt. */
export const CLOSING_DAYS_BACK = 3;

export type ImageKind = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

/**
 * Avgör bildtyp ur filens FÖRSTA BYTE, aldrig ur filnamn eller klientens angivna typ (de kan vara falska).
 * Bara JPEG, PNG och WebP godtas. Annat (PDF, HTML, SVG, körbara filer) avvisas.
 */
export function detectImage(bytes: Uint8Array): ImageKind | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(at(0), at(1), at(2), at(3)) === "RIFF" &&
    String.fromCharCode(at(8), at(9), at(10), at(11)) === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

/** "12 345,50" -> ören. Avvisar negativa tal, text och orimligt stora belopp. */
export function parseDayTotal(input: string): { ok: true; ore: number } | { ok: false; message: string } {
  if (!input.trim()) return { ok: false, message: "Ange dagens summa i kronor." };
  try {
    const ore = kronorToOre(input.replace(/ /g, " ").replace(/\s*kr$/i, ""));
    if (ore > MAX_DAY_TOTAL_ORE) return { ok: false, message: "Beloppet är för stort. Kontrollera dagens summa." };
    return { ok: true, ore };
  } catch {
    return { ok: false, message: "Dagens summa ska vara ett belopp i kronor, t.ex. 12 345,50." };
  }
}

/** Datumen ett avslut kan gälla (idag och några dagar bakåt), senast först. */
export function allowedClosingDates(today: string): string[] {
  return Array.from({ length: CLOSING_DAYS_BACK + 1 }, (_, i) => addDaysToDateString(today, -i));
}

export function isAllowedClosingDate(date: string, today: string): boolean {
  return allowedClosingDates(today).includes(date);
}

/** Lagringsnyckel: dagsavslut/{år}/{månad}/{dag}/dagsavslut-{id}.{ext}. Bara siffror, bokstäver och bindestreck i id. */
export function closingStorageKey(workDate: string, id: string, ext: ImageKind["ext"]): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw new RangeError("Ogiltigt datum");
  if (!/^[a-f0-9-]{8,64}$/.test(id)) throw new RangeError("Ogiltigt id");
  const [y, m, d] = workDate.split("-");
  return `dagsavslut/${y}/${m}/${d}/dagsavslut-${id}.${ext}`;
}
