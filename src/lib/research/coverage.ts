import type { CustomerRevenue } from "@/lib/metrics";
import { add, money, ratio, type Money } from "@/lib/money";

import type { CustomerResearch } from "./customer";

/**
 * How much of the reporting month's revenue comes from customers whose
 * identity checks out. Computed at issuance and frozen, like every figure.
 */
export interface ResearchCoverage {
  total: Money;
  verified: Money;
  needsReview: Money;
  flagged: Money;
  /** Aggregated payouts and customers that couldn't be researched individually. */
  unresearched: Money;
  /** verified ÷ total, to three decimals. Null when there is no revenue. */
  verifiedShare: number | null;
  /** Each status's share of total, for drawing the split. All zero without revenue. */
  shares: { verified: number; needsReview: number; flagged: number; unresearched: number };
  simulated: boolean;
  counts: { verified: number; needsReview: number; flagged: number; adverseNews: number };
}

export function summarizeCoverage(
  customers: readonly CustomerRevenue[],
  research: Readonly<Record<string, CustomerResearch>>,
  currency: string,
): ResearchCoverage {
  const zero = money(0, currency);
  const coverage: ResearchCoverage = {
    total: zero, verified: zero, needsReview: zero, flagged: zero, unresearched: zero,
    verifiedShare: null, shares: { verified: 0, needsReview: 0, flagged: 0, unresearched: 0 }, simulated: false,
    counts: { verified: 0, needsReview: 0, flagged: 0, adverseNews: 0 },
  };
  for (const customer of customers) {
    coverage.total = add(coverage.total, customer.amount);
    const result = customer.customerId ? research[customer.customerId] : undefined;
    if (!result) {
      coverage.unresearched = add(coverage.unresearched, customer.amount);
      continue;
    }
    if (result.provider === "simulated") coverage.simulated = true;
    if (result.flags?.includes("adverse_news")) coverage.counts.adverseNews += 1;
    if (result.status === "Verified") {
      coverage.verified = add(coverage.verified, customer.amount);
      coverage.counts.verified += 1;
    } else if (result.status === "Flagged") {
      coverage.flagged = add(coverage.flagged, customer.amount);
      coverage.counts.flagged += 1;
    } else {
      coverage.needsReview = add(coverage.needsReview, customer.amount);
      coverage.counts.needsReview += 1;
    }
  }
  if (coverage.total.minor > 0) {
    const share = (part: Money) => Math.round(ratio(part, coverage.total) * 1000) / 1000;
    coverage.verifiedShare = share(coverage.verified);
    coverage.shares = {
      verified: share(coverage.verified),
      needsReview: share(coverage.needsReview),
      flagged: share(coverage.flagged),
      unresearched: share(coverage.unresearched),
    };
  }
  return coverage;
}
