/**
 * The metric engine.
 *
 * Pure, deterministic arithmetic over classified transactions. No model touches
 * a number here — an LLM may later phrase a verdict, but never compute one.
 *
 * Every metric carries the transaction ids that produced it. That is not
 * bookkeeping: it *is* the product. The receipt lets an investor click a figure
 * and see the bank rows behind it, which is only possible because each value
 * drags its evidence along.
 *
 * Nothing reads the clock. Callers pass `asOf`, which against the fixture is the
 * dataset anchor, so results never drift.
 */

import {
  type Money,
  add,
  allocate,
  isZero,
  money,
  ratio,
  scale,
  subtract,
  sum,
  zero,
} from "@/lib/money";
import {
  type Period,
  addMonths,
  completeTrailingMonths,
  contains,
  formatPeriod,
  monthsBetween,
  periodForInstant,
} from "@/lib/period";
import type { Classification } from "@/lib/classify";

export interface MetricValue<T> {
  value: T;
  /** Rho transaction ids behind this figure — the drill-down. */
  transactionIds: string[];
  /** Plain-English statement of how it was derived. Shown on the receipt. */
  method: string;
}

export interface CustomerRevenue {
  customerId: string | null;
  customerName: string;
  amount: Money;
  transactionIds: string[];
  /** Whether an invoice confirmed this, or it was inferred. */
  attribution: Classification["attribution"];
}

export interface MonthlyRevenue {
  periodKey: string;
  period: Period;
  revenue: Money;
  byCustomer: CustomerRevenue[];
  transactionIds: string[];
}

export interface ExcludedGroup {
  cashClass: string;
  count: number;
  amount: Money;
  reason: string;
  transactionIds: string[];
}

/** A counterparty that both pays us and is paid by us. */
export interface RelatedParty {
  customerId: string | null;
  customerName: string;
  moneyIn: Money;
  moneyOut: Money;
  transactionIds: string[];
}

export interface Receipt {
  currency: string;
  asOf: Date;
  /** The most recent month that has actually finished. */
  reportingPeriod: Period;
  cashOnHand: MetricValue<Money>;
  mrr: MetricValue<Money>;
  arr: MetricValue<Money>;
  netBurn: MetricValue<Money>;
  /**
   * Prepayments for future months received during the reporting month. They
   * count in full toward cash burn, so they flatter it — the receipt says so
   * on the burn line itself rather than leaving it to be discovered.
   */
  prepaymentsInPeriod: MetricValue<Money>;
  /** Operating cash in and out behind net burn; in + out = −netBurn. */
  operatingIn: Money;
  operatingOut: Money;
  runwayMonths: MetricValue<number | null>;
  /** Average of the months below — the runway denominator. */
  averageMonthlyBurn: Money;
  /** Net burn for each complete month in the runway window, oldest first. */
  trailingBurn: {
    periodKey: string;
    netBurn: Money;
    transactionIds: string[];
  }[];
  growthRate: MetricValue<number | null>;
  /**
   * Change in recognised revenue versus three months earlier. The headline
   * growth figure: month over month is too noisy to lead with.
   */
  growth3Month: MetricValue<number | null>;
  concentration: MetricValue<{
    topCustomerShare: number | null;
    topCustomerName: string | null;
    topFiveShare: number | null;
    customers: (CustomerRevenue & { share: number | null })[];
  }>;
  monthlyRevenue: MonthlyRevenue[];
  /** What was deliberately left out, and why. Transparency is the point. */
  excluded: ExcludedGroup[];
  /** Circular flows, surfaced rather than netted away. */
  relatedParties: RelatedParty[];
}

/** A payment slice recognised into one month, with its originating verdict. */
interface RecognisedEntry {
  source: Classification;
  amount: Money;
}

export interface EngineInput {
  classifications: readonly Classification[];
  /** Current balances of cash accounts. */
  cashBalances: readonly Money[];
  asOf: Date;
  currency: string;
  timeZone?: string;
}

/**
 * Spreads each payment across the months it covers.
 *
 * A $96,000 annual prepayment is not $96,000 of revenue in August; it is $8,000
 * a month for twelve months. Recognising it in one month spikes that month and
 * leaves eleven looking dead, which corrupts MRR, growth and burn all at once.
 * `allocate` guarantees the twelve parts sum back to the original exactly.
 */
function recogniseRevenue(
  classifications: readonly Classification[],
  timeZone: string | undefined,
): Map<string, { amount: Money; entries: RecognisedEntry[] }> {
  const byPeriod = new Map<
    string,
    { amount: Money; entries: RecognisedEntry[] }
  >();

  for (const item of classifications) {
    if (!item.countsAsRevenue || !item.postedAt) continue;

    const startPeriod = periodForInstant(item.postedAt, timeZone);
    const months = Math.max(1, item.coversMonths);
    const parts =
      months === 1
        ? [item.amount]
        : allocate(item.amount, Array(months).fill(1));

    parts.forEach((part, offset) => {
      const period = offset === 0 ? startPeriod : addMonths(startPeriod, offset);
      const bucket = byPeriod.get(period.key) ?? {
        amount: zero(part.currency),
        entries: [],
      };
      bucket.amount = add(bucket.amount, part);
      // The *recognised slice*, not the original payment. Rolling up the raw
      // amount here would show a customer's annual prepayment in full in every
      // month it touches — twelve times the truth in the per-customer view.
      bucket.entries.push({ source: item, amount: part });
      byPeriod.set(period.key, bucket);
    });
  }

  return byPeriod;
}

function rollUpByCustomer(
  entries: readonly RecognisedEntry[],
): CustomerRevenue[] {
  const groups = new Map<string, CustomerRevenue>();

  for (const { source, amount } of entries) {
    const key =
      source.customerId ??
      (source.attribution === "aggregated"
        ? `aggregated:${source.customerName ?? "processor"}`
        : `unattributed`);
    const name =
      source.customerName ??
      (source.attribution === "aggregated"
        ? "Self-serve (aggregated payouts)"
        : "Unattributed");

    const existing = groups.get(key);
    if (existing) {
      existing.amount = add(existing.amount, amount);
      existing.transactionIds.push(source.rhoTransactionId);
    } else {
      groups.set(key, {
        customerId: source.customerId,
        customerName: name,
        amount,
        transactionIds: [source.rhoTransactionId],
        attribution: source.attribution,
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.amount.minor - a.amount.minor);
}

export function buildReceipt(input: EngineInput): Receipt {
  const { classifications, asOf, currency, timeZone } = input;

  // --- Cash on hand --------------------------------------------------------
  const cashOnHand = sum(input.cashBalances, currency);

  // --- Reporting period: the last month that actually finished -------------
  const [reportingPeriod] = completeTrailingMonths(asOf, 1, timeZone);

  // --- Revenue recognition -------------------------------------------------
  const recognised = recogniseRevenue(classifications, timeZone);

  const periodsWithRevenue = [...recognised.keys()].sort();
  const monthlyRevenue: MonthlyRevenue[] =
    periodsWithRevenue.length === 0
      ? []
      : monthsBetween(
          parseKey(periodsWithRevenue[0], timeZone),
          reportingPeriod,
        ).map((period) => {
          const bucket = recognised.get(period.key);
          const entries = bucket?.entries ?? [];
          return {
            periodKey: period.key,
            period,
            revenue: bucket?.amount ?? zero(currency),
            byCustomer: rollUpByCustomer(entries),
            transactionIds: [
              ...new Set(entries.map((e) => e.source.rhoTransactionId)),
            ],
          };
        });

  const currentMonth = monthlyRevenue.find(
    (m) => m.periodKey === reportingPeriod.key,
  );
  const previousMonth = monthlyRevenue.find(
    (m) => m.periodKey === addMonths(reportingPeriod, -1).key,
  );

  const mrrValue = currentMonth?.revenue ?? zero(currency);

  // --- Net burn over the reporting month -----------------------------------
  const operating = classifications.filter(
    (c) =>
      c.countsAsOperating &&
      c.postedAt !== null &&
      contains(reportingPeriod, c.postedAt),
  );
  const netMovement = sum(
    operating.map((c) => c.amount),
    currency,
  );
  // Burn is reported positive when money is going out.
  const netBurn = money(-netMovement.minor, currency);
  const prepayments = operating.filter(
    (c) => c.countsAsRevenue && c.coversMonths > 1 && c.amount.minor > 0,
  );
  const prepaymentsInPeriod = sum(
    prepayments.map((c) => c.amount),
    currency,
  );
  const operatingIn = sum(
    operating.filter((c) => c.amount.minor > 0).map((c) => c.amount),
    currency,
  );
  const operatingOut = sum(
    operating.filter((c) => c.amount.minor < 0).map((c) => c.amount),
    currency,
  );

  // --- Runway --------------------------------------------------------------
  const trailing = completeTrailingMonths(asOf, 3, timeZone);
  const trailingOperating = classifications.filter(
    (c) =>
      c.countsAsOperating &&
      c.postedAt !== null &&
      trailing.some((period) => contains(period, c.postedAt!)),
  );
  const trailingNet = sum(
    trailingOperating.map((c) => c.amount),
    currency,
  );
  const averageMonthlyBurn = money(
    Math.round(-trailingNet.minor / trailing.length),
    currency,
  );
  const trailingBurn = trailing.map((period) => {
    const inPeriod = trailingOperating.filter((c) =>
      contains(period, c.postedAt!),
    );
    const net = sum(inPeriod.map((c) => c.amount), currency);
    return {
      periodKey: period.key,
      netBurn: money(-net.minor, currency),
      transactionIds: inPeriod.map((c) => c.rhoTransactionId),
    };
  });
  const runwayMonths =
    averageMonthlyBurn.minor <= 0
      ? null // Not burning; runway is not a meaningful number.
      : Math.round(ratio(cashOnHand, averageMonthlyBurn) * 10) / 10;

  // --- Growth --------------------------------------------------------------
  const growthRate =
    previousMonth && !isZero(previousMonth.revenue)
      ? Math.round(
          (ratio(subtract(mrrValue, previousMonth.revenue), previousMonth.revenue)) *
            1000,
        ) / 1000
      : null;

  // --- Three-month growth -----------------------------------------------------
  const threeBack = monthlyRevenue.find(
    (m) => m.periodKey === addMonths(reportingPeriod, -3).key,
  );
  const growth3Month =
    threeBack && !isZero(threeBack.revenue)
      ? Math.round(
          ratio(subtract(mrrValue, threeBack.revenue), threeBack.revenue) * 1000,
        ) / 1000
      : null;

  // --- Concentration over the trailing twelve months -----------------------
  const twelve = monthlyRevenue.slice(-12);
  const twelveEntries = twelve.flatMap((m) => m.byCustomer);
  const concentrationCustomers = mergeCustomerRevenue(twelveEntries);
  const twelveTotal = sum(
    concentrationCustomers.map((c) => c.amount),
    currency,
  );
  const topCustomer = concentrationCustomers[0] ?? null;
  const topFive = concentrationCustomers.slice(0, 5);

  const share = (part: Money) =>
    isZero(twelveTotal) ? null : Math.round(ratio(part, twelveTotal) * 1000) / 1000;

  // --- What was excluded, and why ------------------------------------------
  const excluded = summariseExclusions(classifications);

  // --- Related parties ------------------------------------------------------
  const relatedParties = summariseRelatedParties(classifications, currency);

  return {
    currency,
    asOf,
    reportingPeriod,
    cashOnHand: {
      value: cashOnHand,
      transactionIds: [],
      method:
        "Sum of the current balances of every connected checking, savings and " +
        "treasury account. Card and rewards balances are not cash.",
    },
    mrr: {
      value: mrrValue,
      transactionIds: currentMonth?.transactionIds ?? [],
      method:
        `Revenue recognised in ${formatPeriod(reportingPeriod)}, the most recent complete ` +
        `month. Payments covering several months are spread across them, so an ` +
        `annual prepayment does not spike a single month.`,
    },
    arr: {
      value: scale(mrrValue, 12),
      transactionIds: currentMonth?.transactionIds ?? [],
      method: "Monthly recurring revenue multiplied by twelve.",
    },
    netBurn: {
      value: netBurn,
      transactionIds: operating.map((c) => c.rhoTransactionId),
      method:
        `Operating cash out minus operating cash in for ${formatPeriod(reportingPeriod)}. ` +
        `Investment, transfers between your own accounts, and interest are all ` +
        `excluded. This is cash, not recognised revenue: a prepayment counts in ` +
        `full in the month it arrives, even though MRR spreads it out.`,
    },
    prepaymentsInPeriod: {
      value: prepaymentsInPeriod,
      transactionIds: prepayments.map((c) => c.rhoTransactionId),
      method:
        `Payments received in ${formatPeriod(reportingPeriod)} that cover future ` +
        `months. They lower this month's cash burn in full, so burn in a normal ` +
        `month is higher than this figure suggests.`,
    },
    operatingIn,
    operatingOut,
    runwayMonths: {
      value: runwayMonths,
      transactionIds: trailingOperating.map((c) => c.rhoTransactionId),
      method:
        `Cash on hand divided by average net burn over the last three complete ` +
        `months (${trailing.map(formatPeriod).join(", ")}). The month in progress ` +
        `is excluded — a partial month would understate burn and overstate runway.`,
    },
    averageMonthlyBurn,
    trailingBurn,
    growthRate: {
      value: growthRate,
      transactionIds: [
        ...(currentMonth?.transactionIds ?? []),
        ...(previousMonth?.transactionIds ?? []),
      ],
      method: previousMonth
        ? `Change in recognised revenue from ${formatPeriod(previousMonth.period)} to ${formatPeriod(reportingPeriod)}.`
        : "Not enough history to compute a growth rate.",
    },
    growth3Month: {
      value: growth3Month,
      transactionIds: [
        ...(currentMonth?.transactionIds ?? []),
        ...(threeBack?.transactionIds ?? []),
      ],
      method: threeBack
        ? `Change in recognised revenue from ${formatPeriod(threeBack.period)} to ${formatPeriod(reportingPeriod)}.`
        : "Not enough history to compute three-month growth.",
    },
    concentration: {
      value: {
        topCustomerShare: topCustomer ? share(topCustomer.amount) : null,
        topCustomerName: topCustomer?.customerName ?? null,
        topFiveShare: topFive.length
          ? share(sum(topFive.map((c) => c.amount), currency))
          : null,
        customers: concentrationCustomers.map((c) => ({
          ...c,
          share: share(c.amount),
        })),
      },
      transactionIds: concentrationCustomers.flatMap((c) => c.transactionIds),
      method:
        "Each customer's share of revenue recognised over the last twelve months.",
    },
    monthlyRevenue,
    excluded,
    relatedParties,
  };
}

function summariseRelatedParties(
  classifications: readonly Classification[],
  currency: string,
): RelatedParty[] {
  const groups = new Map<
    string,
    { name: string; id: string | null; items: Classification[] }
  >();
  for (const item of classifications) {
    // Settled, in-perimeter movements only: a pending wire is not yet a flow.
    if (!item.relatedParty || !item.countsAsOperating) continue;
    const key = item.customerId ?? item.customerName ?? item.rhoTransactionId;
    const group = groups.get(key) ?? {
      name: item.customerName ?? "Unknown counterparty",
      id: item.customerId,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      customerId: group.id,
      customerName: group.name,
      moneyIn: sum(
        group.items.filter((i) => i.amount.minor > 0).map((i) => i.amount),
        currency,
      ),
      moneyOut: sum(
        group.items.filter((i) => i.amount.minor < 0).map((i) => i.amount),
        currency,
      ),
      transactionIds: group.items.map((i) => i.rhoTransactionId),
    }))
    .sort((a, b) => b.moneyIn.minor - a.moneyIn.minor);
}

function mergeCustomerRevenue(
  entries: readonly CustomerRevenue[],
): CustomerRevenue[] {
  const groups = new Map<string, CustomerRevenue>();
  for (const entry of entries) {
    const key = entry.customerId ?? entry.customerName;
    const existing = groups.get(key);
    if (existing) {
      existing.amount = add(existing.amount, entry.amount);
      existing.transactionIds.push(...entry.transactionIds);
    } else {
      groups.set(key, { ...entry, transactionIds: [...entry.transactionIds] });
    }
  }
  for (const group of groups.values()) {
    group.transactionIds = [...new Set(group.transactionIds)];
  }
  return [...groups.values()]
    .filter((c) => c.amount.minor > 0)
    .sort((a, b) => b.amount.minor - a.amount.minor);
}

function summariseExclusions(
  classifications: readonly Classification[],
): ExcludedGroup[] {
  const excludedClasses = new Set([
    "financing",
    "internal_transfer",
    "other_income",
    "unclassified",
    "reversed",
    "unsettled",
    "non_cash",
  ]);

  const groups = new Map<string, ExcludedGroup>();
  for (const item of classifications) {
    if (!excludedClasses.has(item.cashClass)) continue;
    const existing = groups.get(item.cashClass);
    if (existing) {
      existing.count += 1;
      existing.amount = add(existing.amount, item.amount);
      existing.transactionIds.push(item.rhoTransactionId);
    } else {
      groups.set(item.cashClass, {
        cashClass: item.cashClass,
        count: 1,
        amount: item.amount,
        reason: item.reason,
        transactionIds: [item.rhoTransactionId],
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) => Math.abs(b.amount.minor) - Math.abs(a.amount.minor),
  );
}

function parseKey(key: string, timeZone: string | undefined): Period {
  const [year, month] = key.split("-").map(Number);
  return periodForInstant(new Date(Date.UTC(year, month - 1, 15)), timeZone);
}
