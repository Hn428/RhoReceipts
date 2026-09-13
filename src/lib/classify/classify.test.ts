import { describe, expect, it } from "vitest";

import accounts from "@/lib/rho/fixtures/northstar-labs/accounts.json";
import customers from "@/lib/rho/fixtures/northstar-labs/customers.json";
import invoices from "@/lib/rho/fixtures/northstar-labs/invoices.json";
import transactions from "@/lib/rho/fixtures/northstar-labs/transactions.json";
import type {
  RhoAccount,
  RhoInvoice,
  RhoInvoicingCustomer,
  RhoTransaction,
} from "@/lib/rho/types";

import { classifyLedger } from "./index";

const { classifications, byTransactionId } = classifyLedger({
  transactions: transactions as unknown as RhoTransaction[],
  accounts: accounts as unknown as RhoAccount[],
  invoices: invoices as unknown as RhoInvoice[],
  customers: customers as unknown as RhoInvoicingCustomer[],
});

const find = (predicate: (t: RhoTransaction) => boolean) =>
  (transactions as unknown as RhoTransaction[]).filter(predicate);

const classOf = (id: string) => byTransactionId.get(id)!.cashClass;

describe("coverage", () => {
  it("classifies every transaction exactly once", () => {
    expect(classifications).toHaveLength(transactions.length);
    expect(byTransactionId.size).toBe(transactions.length);
  });

  it("leaves nothing in a default bucket by accident", () => {
    const unclassified = classifications.filter(
      (c) => c.cashClass === "unclassified",
    );
    // Only the genuinely unrecognisable inflows: the offline cheque payer.
    expect(unclassified.length).toBeLessThan(5);
  });
});

describe("the financing trap", () => {
  it("does not count a seed round as revenue", () => {
    const rounds = find(
      (t) => t.counterparty_name === "Harborline Ventures II LP",
    );
    expect(rounds).toHaveLength(2);
    for (const round of rounds) {
      const verdict = byTransactionId.get(round.id)!;
      expect(verdict.cashClass).toBe("financing");
      expect(verdict.countsAsRevenue).toBe(false);
      expect(verdict.countsAsOperating).toBe(false);
    }
  });

  it("keeps $3.25M of financing out of revenue entirely", () => {
    const financing = classifications.filter((c) => c.cashClass === "financing");
    const total = financing.reduce((s, c) => s + c.amount.minor, 0);
    expect(total).toBe(325_000_000);
  });
});

describe("internal transfers", () => {
  it("nets out treasury sweeps, both legs", () => {
    const sweeps = find((t) => t.transaction_type === "internal_transfer");
    expect(sweeps.length).toBeGreaterThan(0);
    for (const leg of sweeps) {
      expect(classOf(leg.id)).toBe("internal_transfer");
    }
  });

  it("counts a card repayment as real spend, because cash leaves the bank", () => {
    // Both legs share a movement id, but only the checking leg is inside the
    // cash perimeter — so this must NOT be treated as an internal transfer.
    const repayments = find(
      (t) =>
        t.transaction_type === "credit_repayment" &&
        t.account_id === "acc_checking_main",
    );
    expect(repayments.length).toBeGreaterThan(0);
    for (const leg of repayments) {
      const verdict = byTransactionId.get(leg.id)!;
      expect(verdict.cashClass).toBe("operating_expense");
      expect(verdict.countsAsOperating).toBe(true);
    }
  });

  it("ignores card spend itself, so it is never counted twice", () => {
    const swipes = find(
      (t) => t.transaction_type === "card_debit" && t.status === "settled",
    );
    expect(swipes.length).toBeGreaterThan(0);
    for (const swipe of swipes) expect(classOf(swipe.id)).toBe("non_cash");
  });

  it("cancels a reversed vendor payment", () => {
    const palmer = find((t) => t.counterparty_name === "Palmer Creative Studio");
    expect(palmer).toHaveLength(2);
    for (const leg of palmer) expect(classOf(leg.id)).toBe("reversed");
  });
});

describe("revenue attribution", () => {
  it("confirms invoiced revenue without inference", () => {
    const corvus = find((t) => t.counterparty_name === "Corvus Systems, Inc.");
    const verdict = byTransactionId.get(corvus[0].id)!;
    expect(verdict.cashClass).toBe("revenue");
    expect(verdict.attribution).toBe("invoice");
    expect(verdict.customerName).toBe("Corvus Systems, Inc.");
  });

  it("reads the amortisation window from the invoice, not a guess", () => {
    const annual = find(
      (t) => t.counterparty_name === "Atlas Freight Partners",
    );
    expect(annual.length).toBeGreaterThan(0);
    expect(byTransactionId.get(annual[0].id)!.coversMonths).toBe(12);
  });

  it("marks processor payouts as revenue but unattributable", () => {
    const stripe = find((t) => t.counterparty_name === "Stripe Payments");
    const verdict = byTransactionId.get(stripe[0].id)!;
    expect(verdict.cashClass).toBe("revenue");
    expect(verdict.attribution).toBe("aggregated");
    expect(verdict.customerId).toBeNull();
    expect(verdict.reason).toMatch(/cannot be determined/);
  });

  it("infers an uninvoiced customer by name, and says so", () => {
    const cobalt = find((t) => t.counterparty_name === "Cobalt Holdings Group");
    const verdict = byTransactionId.get(cobalt[0].id)!;
    expect(verdict.cashClass).toBe("revenue");
    expect(verdict.attribution).toBe("name_match");
    expect(verdict.reason).toMatch(/inferred rather than confirmed/);
  });

  it("refuses to count an inflow it cannot explain", () => {
    const cheque = find(
      (t) => t.counterparty_name === "Larkspur Municipal District",
    );
    const verdict = byTransactionId.get(cheque[0].id)!;
    expect(verdict.cashClass).toBe("unclassified");
    expect(verdict.countsAsRevenue).toBe(false);
  });

  it("treats a customer refund as negative revenue, not spend", () => {
    const refund = find(
      (t) =>
        t.counterparty_name === "Bellweather Foods Inc." && t.amount.amount < 0,
    );
    expect(refund).toHaveLength(1);
    const verdict = byTransactionId.get(refund[0].id)!;
    expect(verdict.cashClass).toBe("revenue_refund");
    expect(verdict.countsAsRevenue).toBe(true);
  });
});

describe("non-revenue income", () => {
  it("keeps interest and rewards out of revenue", () => {
    for (const type of ["savings_interest", "treasury_interest", "rewards_accrual"]) {
      const rows = find((t) => t.transaction_type === type);
      expect(rows.length).toBeGreaterThan(0);
      const verdict = byTransactionId.get(rows[0].id)!;
      expect(verdict.countsAsRevenue).toBe(false);
    }
  });
});

describe("unsettled money", () => {
  it("counts nothing that has not settled", () => {
    for (const status of ["pending", "failed", "awaiting_approval"]) {
      const rows = find((t) => t.status === status);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const verdict = byTransactionId.get(row.id)!;
        expect(verdict.cashClass).toBe("unsettled");
        expect(verdict.countsAsRevenue).toBe(false);
        expect(verdict.countsAsOperating).toBe(false);
      }
    }
  });
});

describe("every verdict explains itself", () => {
  it("gives a non-empty reason for the drill-down", () => {
    for (const item of classifications) {
      expect(item.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("related-party flows", () => {
  const quill = find((t) => t.counterparty_name === "Quill & Stone LLC");

  it("does not net a payment to a customer off their revenue", () => {
    // Quill & Stone pays us $8,500/mo and we pay them $9,000/mo. Netting those
    // would show roughly -$500 and hide both sides entirely.
    const outflows = quill.filter((t) => t.amount.amount < 0);
    expect(outflows.length).toBeGreaterThan(0);
    for (const out of outflows) {
      const verdict = byTransactionId.get(out.id)!;
      expect(verdict.cashClass).toBe("operating_expense");
      expect(verdict.countsAsRevenue).toBe(false);
    }
  });

  it("flags both directions as related-party", () => {
    for (const txn of quill.filter((t) => t.status === "settled")) {
      expect(byTransactionId.get(txn.id)!.relatedParty).toBe(true);
    }
  });

  it("still recognises a genuine refund by its memo", () => {
    const refund = find(
      (t) =>
        t.counterparty_name === "Bellweather Foods Inc." && t.amount.amount < 0,
    )[0];
    const verdict = byTransactionId.get(refund.id)!;
    expect(verdict.cashClass).toBe("revenue_refund");
    expect(verdict.relatedParty).toBe(false);
  });

  it("leaves ordinary customers unflagged", () => {
    const corvus = find((t) => t.counterparty_name === "Corvus Systems, Inc.")[0];
    expect(byTransactionId.get(corvus.id)!.relatedParty).toBe(false);
  });
});

describe("invoice references", () => {
  it("carries the human-readable invoice number for confirmed revenue", () => {
    const corvus = find((t) => t.counterparty_name === "Corvus Systems, Inc.")[0];
    const verdict = byTransactionId.get(corvus.id)!;
    expect(verdict.invoiceNumber).toMatch(/^NS-\d+$/);
    expect(verdict.reason).toContain(verdict.invoiceNumber!);
  });
});
