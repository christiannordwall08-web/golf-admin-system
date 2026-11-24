/**
 * Pengar hanteras ALLTID som heltal i ören (aldrig flyttal).
 * 140 kr = 14000 ören. Minuter är heltal. Ersättning avrundas en enda gång,
 * halv öre uppåt, på radnivå (per arbetspass).
 */

export type Ore = number;

const NBSP = " ";

function assertSafeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} måste vara ett heltal (fick ${value})`);
  }
}

/** "140", "140,5", "140.50" -> 14000, 14050, 14050. Avvisar negativa tal och fler än 2 decimaler. */
export function kronorToOre(input: string): Ore {
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new RangeError(`Ogiltigt belopp: "${input}"`);
  }
  const kronor = Number(match[1]);
  const decimals = (match[2] ?? "").padEnd(2, "0");
  return kronor * 100 + Number(decimals);
}

/**
 * Ersättning i ören = minuter × timlön(ören) / 60, avrundat halv-upp till hela ören.
 * Beräknas med BigInt så att inget flyttalsfel kan uppstå.
 * 65 h (3900 min) × 14000 öre = 910 000 öre = 9 100 kr.
 */
export function compensationOre(minutes: number, hourlyRateOre: Ore): Ore {
  assertSafeInt(minutes, "minutes");
  assertSafeInt(hourlyRateOre, "hourlyRateOre");
  if (minutes < 0 || hourlyRateOre < 0) {
    throw new RangeError("Minuter och timlön får inte vara negativa");
  }
  const numerator = BigInt(minutes) * BigInt(hourlyRateOre);
  const rounded = (numerator * 2n + 60n) / 120n; // halv-upp: floor((2x + d) / 2d)
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Beloppet är för stort");
  }
  return Number(rounded);
}

/** Summerar belopp utan att riskera heltalsöverflöd. */
export function sumOre(values: readonly Ore[]): bigint {
  let total = 0n;
  for (const v of values) {
    assertSafeInt(v, "belopp");
    total += BigInt(v);
  }
  return total;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 910000 -> "9 100 kr" (hårt mellanslag), 14050 -> "140,50 kr". */
export function formatSek(ore: Ore | bigint): string {
  const value = BigInt(ore);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const kronor = abs / 100n;
  const rest = Number(abs % 100n);
  const kronorText = groupThousands(kronor.toString());
  const restText = rest === 0 ? "" : `,${String(rest).padStart(2, "0")}`;
  return `${negative ? "−" : ""}${kronorText}${restText}${NBSP}kr`;
}

/** 240 -> "4 h", 270 -> "4 h 30 min", 45 -> "45 min". */
export function formatDuration(minutes: number): string {
  assertSafeInt(minutes, "minutes");
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}
