/**
 * Classification: deciding what each bank transaction *means*.
 *
 * This is where the numbers are won or lost. Everything downstream is
 * arithmetic; if a wire from an investor is filed as revenue, every metric on
 * the page becomes fiction, and the word "verified" becomes a liability.
 *
 * Pure and deterministic. No I/O, no clock, no model. Input is the Rho wire
 * data, output is a verdict per transaction with a human-readable reason that
 * the drill-down shows verbatim.
 *
 * Two principles run through the rules:
 *
 * 1. **The cash perimeter.** Cash is checking, savings and investment accounts.
 *    Credit-card and rewards accounts sit outside it. Money moving *within* the
 *    perimeter (a treasury sweep) is not income or spend and nets to zero. Money
 *    crossing the boundary (paying the card bill) genuinely leaves. This one
 *    idea resolves transfers, card spend and repayments without double-counting.
 *
 * 2. **When unsure, exclude from revenue.** Overstating revenue is the failure
 *    that destroys trust; understating it is recoverable and visible. Unmatched
 *    inflows land in `unclassified` and are reported as such rather than
 *    quietly counted.
 */

import { money, type Money } from "@/lib/money";
import type {
  RhoAccount,
  RhoInvoice,
  RhoInvoicingCustomer,
  RhoTransaction,
} from "@/lib/rho/types";

/** Account types whose balances constitute "cash on hand". */
const CASH_ACCOUNT_TYPES = new Set(["checking", "savings", "investment"]);

/** Inflows that are yield or perks, never customer revenue. */
const OTHER_INCOME_TYPES = new Set([
  "savings_interest",
  "treasury_interest",
  "treasury_market_value_adjustment",
  "rewards_accrual",
  "rewards_cashback_redemption",
  "credit_cashback",
]);

/**
 * Counterparties and memos that indicate an investment rather than a sale.
 * Applied only to uninvoiced inflows — an invoice always wins.
 */
const FINANCING_SIGNALS =
  /\b(safe|series\s+[a-z]\b|seed|preferred|convertible|promissory|bridge|equity|investor|ventures?|capital|holdings\s+fund|partners\s+l\.?\s?p\.?|\blp\b|fund\s+(i{1,3}|iv|v)\b|term\s+loan|line\s+of\s+credit|sba\b)\b/i;

/**
 * Memo language that marks money going back to a customer as a genuine refund.
 * Without this, *any* payment to a company that is also a customer would be
 * netted off revenue — which is precisely how a related-party flow disappears.
 */
const REFUND_SIGNALS =
  /\b(refund|credit\s+memo|chargeback|charge\s?back|reversal|returned|rebate)\b/i;

/** Aggregators that settle many customers into one payout. */
const PAYMENT_PROCESSORS =
  /^(stripe|paypal|square|braintree|adyen|shopify\s+payments|chargebee|recurly|lemon\s?squeezy|paddle)\b/i;

export type CashClass =
  | "revenue"
  | "revenue_refund"
  | "financing"
  | "operating_expense"
  | "other_income"
  | "internal_transfer"
  | "reversed"
  | "non_cash"
  | "unsettled"
  | "unclassified";

/** How confident we are about *who* paid. Shown on the receipt, never blended. */
export type Attribution =
  /** An invoice names the customer. No inference involved. */
  | "invoice"
  /** The bank descriptor matches a known customer's legal name. */
  | "name_match"
  /** A processor payout covering many customers; not attributable. */
  | "aggregated"
  | "none";

export interface Classification {
  rhoTransactionId: string;
  accountId: string;
  movementId: string;
  cashClass: CashClass;
  /** Counts toward revenue and therefore MRR. */
  countsAsRevenue: boolean;
  /** Counts toward operating net burn. */
  countsAsOperating: boolean;
  customerId: string | null;
  customerName: string | null;
  attribution: Attribution;
  /** The human-readable number of the invoice that confirms this, if any. */
  invoiceNumber: string | null;
  /**
   * How many months this payment covers. Taken from the invoice line item, so
   * an annual prepayment is amortised from data rather than guessed at.
   */
  coversMonths: number;
  amount: Money;
  postedAt: Date | null;
  /**
   * The counterparty both pays us and is paid by us. Not proof of wrongdoing,
   * but revenue that flows in a circle is the first thing a diligence process
   * looks for, so the receipt surfaces it rather than burying it.
   */
  relatedParty: boolean;
  /** Plain-English justification, surfaced in the drill-down. */
  reason: string;
}

export interface LedgerInput {
  transactions: readonly RhoTransaction[];
  accounts: readonly RhoAccount[];
  invoices: readonly RhoInvoice[];
  customers: readonly RhoInvoicingCustomer[];
}

interface InvoiceLink {
  customerId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  coversMonths: number;
}

/** Invoice payments indexed by the transaction that settled them. */
function indexInvoiceLinks(
  invoices: readonly RhoInvoice[],
): Map<string, InvoiceLink> {
  const index = new Map<string, InvoiceLink>();
  for (const invoice of invoices) {
    // Quantity on a subscription line is the number of months billed, which is
    // how an annual prepayment announces itself.
    const months = Math.max(
      1,
      ...invoice.line_items.map((item) =>
        Number.isFinite(item.quantity) ? Math.round(item.quantity) : 1,
      ),
    );
    for (const payment of invoice.payments) {
      if (!payment.transaction_id) continue;
      index.set(payment.transaction_id, {
        customerId: invoice.customer.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number ?? null,
        coversMonths: months,
      });
    }
  }
  return index;
}

/** Normalises a bank descriptor enough to match a customer's legal name. */
function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|l\.?l\.?c|co|corp|corporation|company|group|partners|llp|plc|gmbh|ab)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface ClassificationResult {
  classifications: Classification[];
  byTransactionId: Map<string, Classification>;
}

export function classifyLedger(input: LedgerInput): ClassificationResult {
  const accountType = new Map(
    input.accounts.map((account) => [account.id, account.account_type]),
  );
  const isCashAccount = (accountId: string) =>
    CASH_ACCOUNT_TYPES.has(accountType.get(accountId) ?? "");

  const invoiceLinks = indexInvoiceLinks(input.invoices);

  const customersByName = new Map<string, RhoInvoicingCustomer>();
  for (const customer of input.customers) {
    customersByName.set(normaliseName(customer.legal_name), customer);
  }
  const customerById = new Map(input.customers.map((c) => [c.id, c]));

  // Group settled legs by movement so both sides of a transfer are visible at
  // once. A single leg cannot tell you whether it is a transfer or a payment.
  // Counterparties that are customers *and* receive money from us, ignoring
  // genuine refunds. Computed up front because a single leg cannot reveal it.
  const relatedPartyNames = new Set<string>();
  for (const txn of input.transactions) {
    if (txn.status !== "settled") continue;
    if (!isCashAccount(txn.account_id)) continue;
    if (txn.amount.amount >= 0) continue;
    const haystack = `${txn.memo ?? ""} ${txn.note ?? ""}`;
    if (REFUND_SIGNALS.test(haystack)) continue;
    const name = normaliseName(txn.counterparty_name);
    if (customersByName.has(name)) relatedPartyNames.add(name);
  }

  const movements = new Map<string, RhoTransaction[]>();
  for (const txn of input.transactions) {
    if (txn.status !== "settled") continue;
    const group = movements.get(txn.money_movement_id) ?? [];
    group.push(txn);
    movements.set(txn.money_movement_id, group);
  }

  const classifications = input.transactions.map((txn) =>
    classifyOne(txn, {
      isCashAccount,
      invoiceLinks,
      customersByName,
      customerById,
      movements,
      relatedPartyNames,
    }),
  );

  return {
    classifications,
    byTransactionId: new Map(classifications.map((c) => [c.rhoTransactionId, c])),
  };
}

interface RuleContext {
  isCashAccount: (accountId: string) => boolean;
  invoiceLinks: Map<string, InvoiceLink>;
  customersByName: Map<string, RhoInvoicingCustomer>;
  customerById: Map<string, RhoInvoicingCustomer>;
  movements: Map<string, RhoTransaction[]>;
  relatedPartyNames: Set<string>;
}

function classifyOne(
  txn: RhoTransaction,
  ctx: RuleContext,
): Classification {
  const base = {
    rhoTransactionId: txn.id,
    accountId: txn.account_id,
    movementId: txn.money_movement_id,
    customerId: null,
    customerName: null,
    attribution: "none" as Attribution,
    invoiceNumber: null,
    coversMonths: 1,
    amount: money(txn.amount.amount, txn.amount.currency),
    postedAt: txn.posted_at ? new Date(txn.posted_at) : null,
    relatedParty: ctx.relatedPartyNames.has(
      normaliseName(txn.counterparty_name),
    ),
  };

  const verdict = (
    cashClass: CashClass,
    reason: string,
    extra: Partial<Classification> = {},
  ): Classification => ({
    ...base,
    cashClass,
    countsAsRevenue: false,
    countsAsOperating: false,
    reason,
    ...extra,
  });

  // --- Rule 1: only settled money is money ---------------------------------
  if (txn.status !== "settled") {
    return verdict(
      "unsettled",
      `Not counted — still ${txn.status.replace(/_/g, " ")}, so no money has moved.`,
    );
  }

  // --- Rule 2: outside the cash perimeter ----------------------------------
  if (!ctx.isCashAccount(txn.account_id)) {
    return verdict(
      "non_cash",
      "Not counted — posted to a card or rewards account, which is not cash. " +
        "The cash effect is captured when the card bill is paid.",
    );
  }

  // --- Rule 3: movements whose legs cancel inside the perimeter ------------
  const legs = (ctx.movements.get(txn.money_movement_id) ?? []).filter((leg) =>
    ctx.isCashAccount(leg.account_id),
  );
  if (legs.length > 1) {
    const net = legs.reduce((total, leg) => total + leg.amount.amount, 0);
    if (net === 0) {
      const accounts = new Set(legs.map((leg) => leg.account_id));
      return accounts.size > 1
        ? verdict(
            "internal_transfer",
            "Not counted — money moved between two of your own accounts. " +
              "Counting it would inflate both revenue and burn.",
          )
        : verdict(
            "reversed",
            "Not counted — this transaction was reversed in full, so it nets to zero.",
          );
    }
  }

  const inflow = txn.amount.amount > 0;
  const link = ctx.invoiceLinks.get(txn.id);

  // --- Rule 4: invoiced inflows are revenue, with no inference -------------
  if (inflow && link) {
    const customer = ctx.customerById.get(link.customerId);
    return verdict("revenue", buildInvoiceReason(link), {
      countsAsRevenue: true,
      countsAsOperating: true,
      customerId: link.customerId,
      customerName: customer?.legal_name ?? null,
      attribution: "invoice",
      invoiceNumber: link.invoiceNumber,
      coversMonths: link.coversMonths,
    });
  }

  if (inflow) {
    // --- Rule 5: yield and perks are income, but not revenue ---------------
    if (OTHER_INCOME_TYPES.has(txn.transaction_type)) {
      return verdict(
        "other_income",
        "Interest, yield or card rewards — real money, but not revenue from customers.",
      );
    }

    // --- Rule 6: investment is not revenue ---------------------------------
    const haystack = `${txn.counterparty_name} ${txn.memo ?? ""} ${txn.note ?? ""}`;
    if (FINANCING_SIGNALS.test(haystack)) {
      return verdict(
        "financing",
        "Investment, not revenue — the counterparty and memo describe a " +
          "financing event. Excluded from revenue and from burn.",
      );
    }

    // --- Rule 7: processor payouts are revenue, but unattributable ---------
    if (PAYMENT_PROCESSORS.test(txn.counterparty_name)) {
      return verdict("revenue", buildProcessorReason(txn.counterparty_name), {
        countsAsRevenue: true,
        countsAsOperating: true,
        attribution: "aggregated",
      });
    }

    // --- Rule 8: descriptor matches a known customer -----------------------
    const matched = ctx.customersByName.get(normaliseName(txn.counterparty_name));
    if (matched) {
      return verdict(
        "revenue",
        "Counted as revenue — the bank descriptor matches a customer on file, " +
          "but no invoice backs it, so the attribution is inferred rather than confirmed.",
        {
          countsAsRevenue: true,
          countsAsOperating: true,
          customerId: matched.id,
          customerName: matched.legal_name,
          attribution: "name_match",
        },
      );
    }

    // --- Rule 9: unknown money in stays out of revenue ---------------------
    return verdict(
      "unclassified",
      "Money in from an unrecognised source. Deliberately excluded from " +
        "revenue: counting an inflow we cannot explain is how metrics become fiction.",
    );
  }

  // --- Outflows ------------------------------------------------------------
  const customerCounterparty = ctx.customersByName.get(
    normaliseName(txn.counterparty_name),
  );

  if (customerCounterparty) {
    const isRefund = REFUND_SIGNALS.test(`${txn.memo ?? ""} ${txn.note ?? ""}`);

    // A genuine refund reduces revenue.
    if (isRefund) {
      return verdict(
        "revenue_refund",
        "Money returned to a customer — subtracted from revenue rather than counted as spend.",
        {
          countsAsRevenue: true,
          countsAsOperating: true,
          customerId: customerCounterparty.id,
          customerName: customerCounterparty.legal_name,
          attribution: "name_match",
        },
      );
    }

    // Otherwise this is a payment to a company that also pays us. Netting it
    // against their revenue would hide both sides of a circular flow.
    return verdict(
      "operating_expense",
      `Paid to ${customerCounterparty.legal_name}, who is also a paying ` +
        `customer. Counted as spend, not as a refund, and flagged: revenue that ` +
        `flows in a circle is the first thing diligence looks for.`,
      {
        countsAsOperating: true,
        customerId: customerCounterparty.id,
        customerName: customerCounterparty.legal_name,
      },
    );
  }

  return verdict("operating_expense", buildExpenseReason(txn), {
    countsAsOperating: true,
  });
}

function buildInvoiceReason(link: InvoiceLink): string {
  const ref = link.invoiceNumber ?? link.invoiceId;
  return link.coversMonths > 1
    ? `Invoiced revenue, confirmed by invoice ${ref}. Covers ` +
        `${link.coversMonths} months, so it is spread across them rather than ` +
        `counted in one.`
    : `Invoiced revenue, confirmed by invoice ${ref} — the payment ` +
        `is linked to the customer by Rho, not inferred from the description.`;
}

function buildProcessorReason(processor: string): string {
  return (
    `Counted as revenue, but ${processor} settles many customers in one payout. ` +
    `Which customers it covers cannot be determined from bank data alone.`
  );
}

function buildExpenseReason(txn: RhoTransaction): string {
  if (txn.transaction_type === "credit_repayment") {
    return "Card bill paid — this is the point the card spend actually leaves your bank.";
  }
  if (txn.transaction_type.includes("fee")) {
    return `Bank fee charged by ${txn.counterparty_name} — counted as operating spend.`;
  }
  return `Operating spend paid to ${txn.counterparty_name}.`;
}
