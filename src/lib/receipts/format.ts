/**
 * Presentation formatting for receipts.
 *
 * Formatting only — turning already-computed values into text. Nothing here
 * adds, averages or rounds a figure that the engine did not already produce.
 */

import { abs, format, type Money } from "@/lib/money";
import { DEFAULT_REPORTING_TIME_ZONE } from "@/lib/period";

const MINUS = "−";

/** Headline figure: whole units, no cents. */
export const whole = (value: Money) => format(value, { showCents: false });

/** Evidence row: full precision with an explicit sign. */
export function signed(value: Money): string {
  const text = format(abs(value));
  if (value.minor > 0) return `+${text}`;
  if (value.minor < 0) return `${MINUS}${text}`;
  return text;
}

/** Magnitude only, for "money out" columns where the heading carries the sign. */
export const unsigned = (value: Money) => format(abs(value));

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: DEFAULT_REPORTING_TIME_ZONE,
});
const DAY_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: DEFAULT_REPORTING_TIME_ZONE,
});

const YEAR = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  timeZone: DEFAULT_REPORTING_TIME_ZONE,
});

export const day = (iso: string) => DAY.format(new Date(iso));
export const dayShort = (iso: string) => DAY_SHORT.format(new Date(iso));
export const year = (iso: string) => YEAR.format(new Date(iso));

export function percent(value: number | null, options: { signed?: boolean } = {}) {
  if (value === null) return "—";
  const text = `${(Math.abs(value) * 100).toFixed(1)}%`;
  if (!options.signed) return text;
  return value > 0 ? `+${text}` : value < 0 ? `${MINUS}${text}` : text;
}

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** Why a group of transactions was left out, in the reader's terms. */
export const EXCLUSION_LABELS: Record<string, string> = {
  financing: "Investment and loans",
  internal_transfer: "Transfers between own accounts",
  other_income: "Interest and rewards",
  non_cash: "Card and rewards account activity",
  unsettled: "Pending, failed or awaiting approval",
  unclassified: "Money in we couldn't explain",
  reversed: "Reversed payments",
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  investment: "Treasury",
  credit: "Card",
  rewards: "Rewards",
};

/** What each excluded group is, in one or two plain sentences. */
export const EXCLUSION_EXPLANATIONS: Record<string, string> = {
  financing:
    "Money from investors or lenders. Real cash, but not revenue — counting it would inflate every figure on this receipt.",
  internal_transfer:
    "Money moving between your own accounts. It nets to zero, and counting either side would inflate both revenue and burn.",
  other_income:
    "Interest, treasury yield and card rewards. Real money, but not earned from customers.",
  non_cash:
    "Card swipes and rewards posted outside your bank accounts. Card spend is counted once, when the bill is paid from checking.",
  unsettled:
    "Transactions that haven't cleared: pending, failed, or awaiting approval. No money has moved yet.",
  unclassified:
    "Money in that couldn't be linked to a customer, investor or known source. Left out rather than guessed at.",
  reversed: "Payments that were returned in full, so they net to zero.",
};
