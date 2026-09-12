import { describe, expect, it } from "vitest";

import accounts from "@/lib/rho/fixtures/accounts.json";
import customers from "@/lib/rho/fixtures/customers.json";
import invoices from "@/lib/rho/fixtures/invoices.json";
import meta from "@/lib/rho/fixtures/meta.json";
import transactions from "@/lib/rho/fixtures/transactions.json";
import { classifyLedger } from "@/lib/classify";
import { format, money } from "@/lib/money";
import type {
  RhoAccount,
  RhoInvoice,
  RhoInvoicingCustomer,
  RhoTransaction,
} from "@/lib/rho/types";

import { buildReceipt } from "./index";

const typedAccounts = accounts as unknown as RhoAccount[];

const { classifications } = classifyLedger({
  transactions: transactions as unknown as RhoTransaction[],
  accounts: typedAccounts,
  invoices: invoices as unknown as RhoInvoice[],
  customers: customers as unknown as RhoInvoicingCustomer[],
});

const cashBalances = typedAccounts
  .filter((a) => ["checking", "savings", "investment"].includes(a.account_type))
  .map((a) => money(a.balance.amount, a.balance.currency));

const receipt = buildReceipt({
  classifications,
  cashBalances,
  // The dataset anchor, never the wall clock — so these expectations never rot.
  asOf: new Date(meta.anchor),
  currency: "USD",
});

describe("reporting window", () => {
  it("reports on the last complete month, not the one in progress", () => {
    // The anchor is 12 September 2026, so September is only partly observed.
    expect(receipt.reportingPeriod.key).toBe("2026-08");
  });
});

describe("cash on hand", () => {
  it("sums only cash accounts, excluding the card balance", () => {
    expect(format(receipt.cashOnHand.value)).toBe("$1,771,069.76");
  });
});

describe("MRR and ARR", () => {
  it("produces a positive MRR for the reporting month", () => {
    expect(receipt.mrr.value.minor).toBeGreaterThan(0);
  });

  it("carries the transactions that produced it", () => {
    expect(receipt.mrr.transactionIds.length).toBeGreaterThan(5);
  });

  it("derives ARR as twelve times MRR", () => {
    expect(receipt.arr.value.minor).toBe(receipt.mrr.value.minor * 12);
  });

  it("spreads the annual prepayment instead of spiking one month", () => {
    // Atlas Freight pays $96,000 once a year. Unamortised it would add
    // $96,000 to a single month; amortised it adds $8,000 to twelve.
    const august = receipt.monthlyRevenue.find((m) => m.periodKey === "2026-08");
    const atlas = august?.byCustomer.find((c) =>
      c.customerName.startsWith("Atlas Freight"),
    );
    expect(atlas).toBeDefined();
    expect(atlas!.amount.minor).toBe(800_000);
  });

  it("keeps monthly revenue smooth across the prepayment month", () => {
    // Without amortisation, August would be several times its neighbours.
    const byKey = new Map(receipt.monthlyRevenue.map((m) => [m.periodKey, m]));
    const july = byKey.get("2026-07")!.revenue.minor;
    const august = byKey.get("2026-08")!.revenue.minor;
    expect(august / july).toBeLessThan(1.3);
    expect(august / july).toBeGreaterThan(0.7);
  });
});

describe("net burn and runway", () => {
  it("reports burn as a positive number when money is going out", () => {
    expect(receipt.netBurn.value.minor).toBeGreaterThan(0);
  });

  it("computes a plausible runway", () => {
    expect(receipt.runwayMonths.value).not.toBeNull();
    expect(receipt.runwayMonths.value!).toBeGreaterThan(5);
    expect(receipt.runwayMonths.value!).toBeLessThan(60);
  });

  it("excludes the partial month from the runway window", () => {
    expect(receipt.runwayMonths.method).toContain("August 2026");
    expect(receipt.runwayMonths.method).not.toContain("September 2026");
  });

  it("never lets financing flatter the burn figure", () => {
    // $3.25M of investment must not appear anywhere in operating movement.
    const financingIds = new Set(
      classifications
        .filter((c) => c.cashClass === "financing")
        .map((c) => c.rhoTransactionId),
    );
    for (const id of receipt.netBurn.transactionIds) {
      expect(financingIds.has(id)).toBe(false);
    }
    for (const id of receipt.runwayMonths.transactionIds) {
      expect(financingIds.has(id)).toBe(false);
    }
  });
});

describe("concentration", () => {
  it("names the largest customer and its share", () => {
    expect(receipt.concentration.value.topCustomerName).toBeTruthy();
    const share = receipt.concentration.value.topCustomerShare!;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });

  it("reports a top-five share at least as large as the top one", () => {
    const { topCustomerShare, topFiveShare } = receipt.concentration.value;
    expect(topFiveShare!).toBeGreaterThanOrEqual(topCustomerShare!);
    expect(topFiveShare!).toBeLessThanOrEqual(1);
  });
});

describe("growth", () => {
  it("computes month-over-month change", () => {
    expect(receipt.growthRate.value).not.toBeNull();
    expect(Math.abs(receipt.growthRate.value!)).toBeLessThan(1);
  });
});

describe("transparency", () => {
  it("reports what it excluded and why", () => {
    const financing = receipt.excluded.find((e) => e.cashClass === "financing");
    expect(financing).toBeDefined();
    expect(financing!.amount.minor).toBe(325_000_000);
    expect(financing!.reason).toMatch(/Investment, not revenue/);
  });

  it("accounts for internal transfers separately", () => {
    expect(
      receipt.excluded.some((e) => e.cashClass === "internal_transfer"),
    ).toBe(true);
  });

  it("gives every metric a stated method", () => {
    for (const metric of [
      receipt.mrr,
      receipt.arr,
      receipt.netBurn,
      receipt.runwayMonths,
      receipt.cashOnHand,
      receipt.concentration,
    ]) {
      expect(metric.method.length).toBeGreaterThan(30);
    }
  });
});

describe("determinism", () => {
  it("produces identical output on a second run", () => {
    const again = buildReceipt({
      classifications,
      cashBalances,
      asOf: new Date(meta.anchor),
      currency: "USD",
    });
    expect(again.mrr.value).toEqual(receipt.mrr.value);
    expect(again.netBurn.value).toEqual(receipt.netBurn.value);
    expect(again.runwayMonths.value).toBe(receipt.runwayMonths.value);
  });
});

describe("runway breakdown", () => {
  it("lists each complete month in the window, oldest first", () => {
    expect(receipt.trailingBurn.map((m) => m.periodKey)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("averages to exactly the runway denominator", () => {
    const total = receipt.trailingBurn.reduce((s, m) => s + m.netBurn.minor, 0);
    expect(receipt.averageMonthlyBurn.minor).toBe(Math.round(total / 3));
  });

  it("matches the reporting month's net burn for its own month", () => {
    const august = receipt.trailingBurn.find((m) => m.periodKey === "2026-08")!;
    expect(august.netBurn).toEqual(receipt.netBurn.value);
  });
});

describe("related parties", () => {
  it("surfaces Quill & Stone with both sides of the circular flow", () => {
    expect(receipt.relatedParties).toHaveLength(1);
    const [quill] = receipt.relatedParties;
    expect(quill.customerName).toBe("Quill & Stone LLC");
    expect(quill.moneyIn.minor).toBe(12_750_000);
    expect(quill.moneyOut.minor).toBe(-12_600_000);
    expect(quill.transactionIds).toHaveLength(29);
  });
});

describe("per-customer shares", () => {
  it("gives every customer a share, summing to the whole", () => {
    const { customers, topCustomerShare } = receipt.concentration.value;
    const total = customers.reduce((s, c) => s + (c.share ?? 0), 0);
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThan(1.01);
    expect(customers[0].share).toBe(topCustomerShare);
  });
});

describe("net burn components", () => {
  it("splits into money in and money out that reconcile exactly", () => {
    expect(receipt.operatingIn.minor).toBeGreaterThan(0);
    expect(receipt.operatingOut.minor).toBeLessThan(0);
    expect(receipt.operatingIn.minor + receipt.operatingOut.minor).toBe(
      -receipt.netBurn.value.minor,
    );
  });
});

describe("prepayments in the reporting month", () => {
  it("names the annual prepayment that flatters August's cash burn", () => {
    // Atlas Freight's $96,000 lands in August 2026 and counts in full as cash.
    expect(receipt.prepaymentsInPeriod.value.minor).toBe(9_600_000);
    expect(receipt.prepaymentsInPeriod.transactionIds).toHaveLength(1);
    expect(receipt.prepaymentsInPeriod.method).toContain("August 2026");
  });
});
