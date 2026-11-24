/**
 * Timlönehistorik. Datum är Stockholm-datum som "YYYY-MM-DD"-strängar.
 * Perioderna är halvöppna [validFrom, validTo) och får aldrig överlappa (databasen
 * garanterar det också). Gällande lön för ett pass bestäms av passets ARBETSDAG.
 * En lönehöjning skriver därför aldrig över historiska pass.
 */

export type RatePeriod = {
  id: string;
  hourlyRateOre: number;
  validFrom: string;
  /** Exklusivt slutdatum. null = tills vidare. */
  validTo: string | null;
};

export type PayRateErrorCode =
  | "INVALID_RATE"
  | "INVALID_DATE"
  | "RATE_UNCHANGED"
  | "RATE_CHANGE_NOT_AFTER_CURRENT"
  | "RATE_CHANGE_BEFORE_LAST_PERIOD"
  | "OVERLAPPING_PERIODS";

export class PayRateError extends Error {
  constructor(
    public readonly code: PayRateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PayRateError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string): void {
  // Date.parse är överseende (2026-02-30 blir 2 mars), så kontrollera med tur-och-retur.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!DATE_RE.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PayRateError("INVALID_DATE", `Ogiltigt datum: "${value}"`);
  }
}

function covers(period: RatePeriod, date: string): boolean {
  return period.validFrom <= date && (period.validTo === null || date < period.validTo);
}

/** Två halvöppna perioder överlappar om vardera börjar före den andra slutar. */
export function periodsOverlap(a: RatePeriod, b: RatePeriod): boolean {
  const aEndsAfterBStarts = a.validTo === null || a.validTo > b.validFrom;
  const bEndsAfterAStarts = b.validTo === null || b.validTo > a.validFrom;
  return aEndsAfterBStarts && bEndsAfterAStarts;
}

export function findOverlap(periods: readonly RatePeriod[]): [RatePeriod, RatePeriod] | null {
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      if (periodsOverlap(periods[i], periods[j])) return [periods[i], periods[j]];
    }
  }
  return null;
}

/** Gällande lönenivå för en arbetsdag, eller null om ingen lön gällde då. */
export function resolveRateForDate(periods: readonly RatePeriod[], date: string): RatePeriod | null {
  assertDate(date);
  const matches = periods.filter((p) => covers(p, date));
  if (matches.length > 1) {
    throw new PayRateError("OVERLAPPING_PERIODS", `Flera lönenivåer gäller ${date}`);
  }
  return matches[0] ?? null;
}

export type RateChangePlan = {
  /** Perioden som ska stängas (sätt validTo), eller null om ingen är öppen. */
  close: { id: string; validTo: string } | null;
  /** Den nya perioden. */
  insert: { hourlyRateOre: number; validFrom: string; validTo: null };
};

/**
 * Planerar en lönehöjning/-sänkning. Ordning i databasen: stäng nuvarande period först,
 * lägg sedan in den nya. Historiska perioder ändras aldrig.
 */
export function planRateChange(
  periods: readonly RatePeriod[],
  change: { hourlyRateOre: number; effectiveFrom: string },
): RateChangePlan {
  if (!Number.isSafeInteger(change.hourlyRateOre) || change.hourlyRateOre < 0) {
    throw new PayRateError("INVALID_RATE", "Timlönen måste vara ett heltal i ören, minst 0.");
  }
  assertDate(change.effectiveFrom);
  if (findOverlap(periods)) {
    throw new PayRateError("OVERLAPPING_PERIODS", "Befintlig lönehistorik har överlappande perioder.");
  }

  const open = periods.filter((p) => p.validTo === null);
  if (open.length > 1) {
    throw new PayRateError("OVERLAPPING_PERIODS", "Flera öppna lönenivåer finns.");
  }

  if (open.length === 1) {
    const current = open[0];
    if (change.effectiveFrom <= current.validFrom) {
      throw new PayRateError(
        "RATE_CHANGE_NOT_AFTER_CURRENT",
        `Ny lön måste gälla från ett senare datum än nuvarande lön (från ${current.validFrom}). Historiska perioder ändras aldrig.`,
      );
    }
    if (change.hourlyRateOre === current.hourlyRateOre) {
      throw new PayRateError("RATE_UNCHANGED", "Den nya timlönen är samma som nuvarande.");
    }
    return {
      close: { id: current.id, validTo: change.effectiveFrom },
      insert: { hourlyRateOre: change.hourlyRateOre, validFrom: change.effectiveFrom, validTo: null },
    };
  }

  // Ingen öppen period: ny period får inte börja före den senast avslutade.
  const lastEnd = periods.reduce<string | null>(
    (max, p) => (p.validTo !== null && (max === null || p.validTo > max) ? p.validTo : max),
    null,
  );
  if (lastEnd !== null && change.effectiveFrom < lastEnd) {
    throw new PayRateError(
      "RATE_CHANGE_BEFORE_LAST_PERIOD",
      `Ny lön får inte börja före tidigare periods slut (${lastEnd}).`,
    );
  }
  return {
    close: null,
    insert: { hourlyRateOre: change.hourlyRateOre, validFrom: change.effectiveFrom, validTo: null },
  };
}
