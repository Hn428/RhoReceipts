/**
 * Money.
 *
 * Every amount in this system is an integer count of minor units (cents for
 * USD) plus a currency. There is no float path, and there is no bare `number`
 * that means money — if a value is money it carries its currency, so adding
 * dollars to pounds is a type-level and runtime error rather than a silent
 * corruption.
 *
 * Division is the dangerous operation, so it is split three ways on purpose:
 *
 *   - `allocate` splits money into parts that sum *exactly* back to the whole.
 *     Use it for amortising an annual prepayment across twelve months.
 *   - `scale` multiplies by a factor with an explicit rounding mode. Use it for
 *     one-off proportions, never in a loop that must reconcile.
 *   - `ratio` leaves Money space entirely and returns a plain number. Use it for
 *     growth rates and concentration percentages, which are not money.
 */

export type CurrencyCode = string;

export interface Money {
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export type RoundingMode = "half-even" | "half-up" | "trunc" | "floor" | "ceil";

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(minor)) {
    throw new MoneyError(
      `Money must be an integer count of minor units, received ${minor}. ` +
        `A fractional value here means a float leaked in upstream.`,
    );
  }
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`Money value ${minor} exceeds safe integer range.`);
  }
  if (!currency) throw new MoneyError("Money requires a currency code.");
  return { minor, currency: currency.toUpperCase() };
}

export const zero = (currency: CurrencyCode): Money => money(0, currency);

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Currency mismatch: ${a.currency} and ${b.currency} cannot be combined.`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export const negate = (a: Money): Money => money(-a.minor, a.currency);
export const abs = (a: Money): Money => money(Math.abs(a.minor), a.currency);

/**
 * Sums a list. The currency is required because an empty list still has to
 * produce a well-formed zero — guessing it from the first element would make
 * `sum([])` untypeable.
 */
export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  let total = 0;
  for (const item of items) {
    if (item.currency !== currency.toUpperCase()) {
      throw new MoneyError(
        `Currency mismatch in sum: expected ${currency}, found ${item.currency}.`,
      );
    }
    total += item.minor;
  }
  return money(total, currency);
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export const equals = (a: Money, b: Money): boolean =>
  a.currency === b.currency && a.minor === b.minor;
export const isZero = (a: Money): boolean => a.minor === 0;
export const isPositive = (a: Money): boolean => a.minor > 0;
export const isNegative = (a: Money): boolean => a.minor < 0;

export function round(value: number, mode: RoundingMode): number {
  switch (mode) {
    case "trunc":
      return Math.trunc(value);
    case "floor":
      return Math.floor(value);
    case "ceil":
      return Math.ceil(value);
    case "half-up":
      return value < 0 ? -Math.round(-value) : Math.round(value);
    case "half-even": {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
  }
}

/**
 * Multiplies by a factor.
 *
 * Defaults to banker's rounding: rounding half away from zero every time
 * introduces a systematic upward drift when applied across many values, which
 * is exactly the kind of bias that makes a "verified" number wrong by a few
 * dollars and impossible to explain.
 */
export function scale(
  amount: Money,
  factor: number,
  mode: RoundingMode = "half-even",
): Money {
  if (!Number.isFinite(factor)) {
    throw new MoneyError(`Cannot scale money by ${factor}.`);
  }
  return money(round(amount.minor * factor, mode), amount.currency);
}

/**
 * Splits money into parts that sum back to the original exactly.
 *
 * Uses the largest-remainder method: floor every share, then hand the leftover
 * minor units out one at a time to the parts with the biggest fractional loss.
 * Naively rounding each share independently loses or invents cents — over
 * twelve months of an amortised annual contract, that is a discrepancy a
 * founder would have to explain to an investor.
 */
export function allocate(amount: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new MoneyError("allocate requires at least one weight.");
  }
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new MoneyError("allocate weights must be finite and non-negative.");
  }

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) {
    throw new MoneyError("allocate weights must not sum to zero.");
  }

  const sign = amount.minor < 0 ? -1 : 1;
  const magnitude = Math.abs(amount.minor);

  const exact = weights.map((w) => (magnitude * w) / totalWeight);
  const shares = exact.map((v) => Math.floor(v));
  let remainder = magnitude - shares.reduce((s, v) => s + v, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % order.length, remainder--) {
    shares[order[i].index] += 1;
  }

  return shares.map((s) => money(sign * s, amount.currency));
}

/**
 * The ratio of two amounts as a plain number. Deliberately leaves Money space:
 * a growth rate is not money, and typing it as such invites nonsense like
 * adding a percentage to a balance.
 */
export function ratio(numerator: Money, denominator: Money): number {
  assertSameCurrency(numerator, denominator);
  if (denominator.minor === 0) {
    throw new MoneyError("Cannot compute a ratio against zero.");
  }
  return numerator.minor / denominator.minor;
}

/** Minor units per major unit. Extend as non-2-decimal currencies appear. */
const MINOR_UNIT_EXPONENT: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
  BHD: 3,
  KWD: 3,
  TND: 3,
};

export const minorUnitExponent = (currency: CurrencyCode): number =>
  MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? 2;

/** Presentation only — this is where money is allowed to become a string. */
export function format(
  amount: Money,
  options: { locale?: string; showCents?: boolean } = {},
): string {
  const exponent = minorUnitExponent(amount.currency);
  const digits =
    options.showCents === false ? 0 : exponent;
  return new Intl.NumberFormat(options.locale ?? "en-US", {
    style: "currency",
    currency: amount.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount.minor / 10 ** exponent);
}

/** Parses "1234.56" without ever constructing a float from the whole value. */
export function fromDecimalString(
  value: string,
  currency: CurrencyCode,
): Money {
  const trimmed = value.trim().replace(/[,_\s]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new MoneyError(`Cannot parse "${value}" as a decimal amount.`);
  }
  const [, sign, whole, fraction = ""] = match;
  const exponent = minorUnitExponent(currency);
  if (fraction.length > exponent) {
    throw new MoneyError(
      `"${value}" has more precision than ${currency} supports (${exponent} places).`,
    );
  }
  const padded = fraction.padEnd(exponent, "0");
  const minor = Number(whole) * 10 ** exponent + Number(padded || "0");
  return money(sign ? -minor : minor, currency);
}

export function toDecimalString(amount: Money): string {
  const exponent = minorUnitExponent(amount.currency);
  const sign = amount.minor < 0 ? "-" : "";
  const magnitude = Math.abs(amount.minor).toString().padStart(exponent + 1, "0");
  if (exponent === 0) return `${sign}${magnitude}`;
  const whole = magnitude.slice(0, -exponent);
  const fraction = magnitude.slice(-exponent);
  return `${sign}${whole}.${fraction}`;
}
