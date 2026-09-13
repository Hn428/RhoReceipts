/**
 * Deterministic Rho API fixture generator.
 *
 *   npm run fixtures
 *
 * Writes src/lib/rho/fixtures/<company>/*.json — one simulated Rho ledger per
 * sample company, served by the mock Rho API.
 *
 * Determinism is the whole point: a fixed seed and a fixed ANCHOR date mean the
 * metric engine can be tested against golden values that never drift. Nothing
 * here calls Date.now(). Regenerating reproduces every file byte for byte.
 *
 * Every company runs the same ledger program with its own profile. The order of
 * random draws is part of the output — reordering two lines below changes every
 * figure downstream — so the program's structure is shared, not copied.
 *
 * Companies:
 *   - Northstar Labs — steady seed-stage SaaS. Plants every case that corrupts a
 *     metric: internal transfers, a round landing as revenue-shaped inflow, an
 *     annual prepayment, churn, expansion, aggregated payouts, a related-party
 *     circular flow, an unverifiable customer, refunds, non-settled rows. Its
 *     figures are pinned by the test suite; changes here must keep it identical.
 *   - Acme AI — faster growth, heavier burn, a concentrated customer base, a
 *     customer who first paid in the reporting month, and an overdue invoice.
 *     Built for the monthly investor receipt.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "rho",
  "fixtures",
);

/** Fixture "today". Everything is generated relative to this, never to the clock. */
const ANCHOR = "2026-09-12T00:00:00.000Z";
const FIRST_YEAR = 2025;
const FIRST_MONTH = 3; // 0-indexed: April 2025
const MONTH_COUNT = 18; // April 2025 .. September 2026

// ---------------------------------------------------------------- primitives

/** mulberry32 — small, fast, seeded. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const usd = (amount: number) => ({ amount, currency: "USD" });
const dollars = (n: number) => Math.round(n * 100);

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

type AccountType = "checking" | "credit" | "investment" | "savings" | "rewards";

type Person = { user_id: string; first_name: string; last_name: string };

type Customer = {
  id: string;
  legal_name: string;
  email: string;
  city: string;
  state: string;
  pay_day: number;
  start_month: number;
  end_month: number; // inclusive; MONTH_COUNT-1 means still active
  cents: number;
  expands_at?: number;
  expands_to?: number;
  cadence: "monthly" | "annual";
  /** Whether payments arrive with a matching Rho invoice. */
  invoiced: boolean;
  /** Months in which this customer did not pay (see unpaid invoices). */
  skip_months?: number[];
  /** Planted signal for the verification layer to catch later. */
  trait?: "related_party" | "unverifiable";
};

type Txn = {
  id: string;
  money_movement_id: string;
  account_id: string;
  account_type: AccountType;
  account_name: string;
  transaction_type: string;
  status: string;
  amount: { amount: number; currency: string };
  initiated_at: string;
  posted_at: string | null;
  counterparty_name: string;
  counterparty_logo_url: string | null;
  memo: string | null;
  note: string | null;
  user_id: string | null;
  user_full_name: string | null;
  card_id: string | null;
  card_name: string | null;
  tracking_number: string | null;
  attachments: { file_id: string; file_name: string }[];
};

type TxInput = {
  account_id: string;
  type: string;
  amount: number;
  initiated_at: string;
  counterparty_name: string;
  memo?: string | null;
  note?: string | null;
  status?: string;
  settle_days?: number;
  money_movement_id?: string;
  user?: Person;
  card_id?: string;
  card_name?: string;
};

/** Helpers handed to a profile's one-off events. */
type ProgramContext = {
  tx: (input: TxInput) => Txn;
  nextMmId: () => string;
  users: Person[];
};

type CompanyProfile = {
  /** Directory name and the source of the mock token. */
  slug: string;
  /**
   * The customers are real businesses used for illustration, so research on them
   * runs live instead of being simulated. The ledger itself is still synthetic,
   * and no business relationship with them is implied.
   */
  realCustomers?: boolean;
  /**
   * Not offered as a sample-company button: a founder connects it by pasting its
   * token, the way a real company would.
   */
  tokenOnly?: boolean;
  legalName: string;
  shortName: string;
  description: string;
  seed: number;
  invoicePrefix: string;
  productName: string;
  users: Person[];
  billingAddress: { street: string; city: string; subdivision: string; postal_code: string };
  accounts: {
    id: string;
    account_type: AccountType;
    suffix: string;
    account_number_last_4: string;
    routing_number_last_4?: string;
    opening_cents: number;
  }[];
  customers: Customer[];
  selfServe: { weeklyStart: number; weeklyGrowth: number };
  financing: { month: number; day: number; amount: number; counterparty: string; memo: string; note: string }[];
  payroll: { base: number; growth: number };
  rent: { amount: number; counterparty: string; memo: string };
  cloud: { base: number; growth: number; counterparty: string; memo: string };
  swipes: { min: number; max: number };
  contractor: { amount: number; counterparty: string; memo: string };
  relatedParty?: { customerId: string; amount: number; memo: string; customerNote: string };
  treasurySweep: { amount: number; fromMonth: number };
  oneOffs?: (ctx: ProgramContext) => void;
  /** Invoices issued but not paid by the anchor date. */
  unpaidInvoices?: { customerId: string; amount: number; issuedAt: string; dueAt: string }[];
};

const SAAS_MERCHANTS = [
  ["Amazon Web Services", 0], ["Vercel", 0], ["GitHub", 0], ["Datadog", 0],
  ["Linear", 0], ["Notion Labs", 0], ["Slack Technologies", 0], ["Figma", 0],
  ["OpenAI", 0], ["Anthropic", 0], ["Google Workspace", 0], ["Zoom", 0],
  ["Sentry", 0], ["Segment", 0], ["Rippling", 0], ["Carta", 0],
  ["Delta Air Lines", 0], ["United Airlines", 0], ["Marriott", 0],
  ["Uber", 0], ["Lyft", 0], ["DoorDash", 0], ["Blue Bottle Coffee", 0],
  ["Apple Store", 0], ["Best Buy", 0], ["Staples", 0],
] as const;

/** "northstar-labs" → "rhobat_mock_northstar_labs_dev_token". */
export const mockTokenFor = (slug: string) =>
  `rhobat_mock_${slug.replace(/-/g, "_")}_dev_token`;

// ------------------------------------------------------------------ program

function generateCompany(profile: CompanyProfile) {
  const rng = makeRng(profile.seed);
  const randInt = (min: number, max: number) =>
    min + Math.floor(rng() * (max - min + 1));
  const pick = <T,>(items: readonly T[]): T => items[randInt(0, items.length - 1)];
  /** Jitter a cent amount by +/- pct, rounded to whole dollars. */
  const jitter = (cents: number, pct: number) =>
    Math.round((cents * (1 + (rng() * 2 - 1) * pct)) / 100) * 100;

  function at(year: number, month: number, day: number, hour = 15): string {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(year, month, Math.min(day, lastDay), hour, randInt(0, 59), 0),
    ).toISOString();
  }

  let txnSeq = 0;
  let mmSeq = 0;
  const nextTxnId = () => `txn_${String(++txnSeq).padStart(6, "0")}`;
  const nextMmId = () => `mm_${String(++mmSeq).padStart(6, "0")}`;

  const USERS = profile.users;
  const CUSTOMERS = profile.customers;

  const ACCOUNTS = profile.accounts.map((a) => ({
    ...a,
    account_name: `${profile.shortName} — ${a.suffix}`,
  }));
  const accountName = (id: string) => ACCOUNTS.find((a) => a.id === id)!.account_name;
  const accountType = (id: string) => ACCOUNTS.find((a) => a.id === id)!.account_type;

  function mrrFor(c: Customer, monthIdx: number): number {
    if (monthIdx < c.start_month || monthIdx > c.end_month) return 0;
    if (c.expands_at !== undefined && monthIdx >= c.expands_at) return c.expands_to!;
    return c.cents;
  }

  const txns: Txn[] = [];

  function tx(p: TxInput): Txn {
    const status = p.status ?? "settled";
    const posted = status === "settled" ? addDays(p.initiated_at, p.settle_days ?? 0) : null;
    const t: Txn = {
      id: nextTxnId(),
      money_movement_id: p.money_movement_id ?? nextMmId(),
      account_id: p.account_id,
      account_type: accountType(p.account_id),
      account_name: accountName(p.account_id),
      transaction_type: p.type,
      status,
      amount: usd(p.amount),
      initiated_at: p.initiated_at,
      posted_at: posted,
      counterparty_name: p.counterparty_name,
      counterparty_logo_url: null,
      memo: p.memo ?? null,
      note: p.note ?? null,
      user_id: p.user?.user_id ?? null,
      user_full_name: p.user ? `${p.user.first_name} ${p.user.last_name}` : null,
      card_id: p.card_id ?? null,
      card_name: p.card_name ?? null,
      tracking_number: null,
      attachments: [],
    };
    txns.push(t);
    return t;
  }

  // --- Cards (drawn before the ledger; order matters) ------------------------
  const CARDS = USERS.map((u, i) => ({
    id: `card_${String(i + 1).padStart(4, "0")}`,
    name: `${u.first_name} ${u.last_name} — Corporate`,
    last_4: String(4200 + i * 137).slice(0, 4),
    type: i === 0 ? ("physical" as const) : ("virtual" as const),
    status: "active" as const,
    cardholder: u,
    spending_limit: usd(dollars(i === 0 ? 25_000 : 10_000)),
    spending_limit_type: "monthly" as const,
    current_spend: usd(dollars(randInt(1_200, 8_400))),
    pending_spend: usd(dollars(randInt(0, 900))),
    spend_period_start: "2026-09-01T00:00:00.000Z",
    spend_period_end: "2026-09-30T23:59:59.000Z",
    usage_starts_at: null,
    usage_ends_at: null,
    billing_address: { ...profile.billingAddress, country_code: "US" },
    shipping_address: null,
    blocked_categories: [] as string[],
    allowed_categories: [] as string[],
    blocked_merchants: [] as string[],
    allowed_merchants: [] as string[],
  }));

  type InvoiceSeed = {
    customer: Customer;
    monthIdx: number;
    cents: number;
    txnId: string;
    paidAt: string;
    months: number;
  };
  const invoiceSeeds: InvoiceSeed[] = [];

  const monthOf = (i: number) => {
    const d = new Date(Date.UTC(FIRST_YEAR, FIRST_MONTH + i, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  };
  /** The fixture stops mid-September 2026; don't emit future-dated rows. */
  const lastDayOf = (i: number) => (i === MONTH_COUNT - 1 ? 11 : 31);

  const operating = profile.accounts.find((a) => a.account_type === "checking")!.id;
  const treasury = profile.accounts.find((a) => a.account_type === "investment")!.id;
  const savings = profile.accounts.find((a) => a.account_type === "savings")!.id;
  const card = profile.accounts.find((a) => a.account_type === "credit")!.id;
  const rewards = profile.accounts.find((a) => a.account_type === "rewards")!.id;

  for (let i = 0; i < MONTH_COUNT; i++) {
    const { y, m } = monthOf(i);
    const maxDay = lastDayOf(i);
    const isCurrent = i === MONTH_COUNT - 1;

    // --- Customer revenue (invoiced ACH credits) ---------------------------
    for (const c of CUSTOMERS) {
      const cents = mrrFor(c, i);
      if (cents === 0) continue;
      if (c.pay_day > maxDay) continue;
      if (c.skip_months?.includes(i)) continue;

      if (c.cadence === "annual") {
        // One payment a year, in the start month and 12 months later.
        const isBillingMonth = (i - c.start_month) % 12 === 0;
        if (!isBillingMonth) continue;
      }

      const initiated = at(y, m, c.pay_day);
      // A few payments land late — realistic, and it stress-tests month boundaries.
      const late = rng() < 0.08 ? randInt(1, 4) : 0;
      // The newest inbound rows are still pending, as they would be in real life.
      const stillPending = isCurrent && c.pay_day >= 8;
      const t = tx({
        account_id: operating,
        type: "ach_credit",
        amount: cents,
        initiated_at: initiated,
        counterparty_name: c.legal_name,
        memo:
          c.cadence === "annual"
            ? `ACH CREDIT ${c.legal_name.toUpperCase()} ANNUAL PLAN`
            : `ACH CREDIT ${c.legal_name.toUpperCase()} INV`,
        status: stillPending ? "pending" : "settled",
        settle_days: late + 1,
      });
      if (c.invoiced) {
        invoiceSeeds.push({
          customer: c,
          monthIdx: i,
          cents,
          txnId: t.id,
          paidAt: t.posted_at ?? t.initiated_at,
          months: c.cadence === "annual" ? 12 : 1,
        });
      }
    }

    // --- Self-serve revenue via aggregated Stripe payouts ------------------
    // Deliberately unattributable to individual customers from bank data alone.
    const weeklyBase = dollars(profile.selfServe.weeklyStart + i * profile.selfServe.weeklyGrowth);
    for (const day of [4, 11, 18, 25]) {
      if (day > maxDay) continue;
      tx({
        account_id: operating,
        type: "ach_credit",
        amount: jitter(weeklyBase, 0.22),
        initiated_at: at(y, m, day, 9),
        counterparty_name: "Stripe Payments",
        memo: "ACH CREDIT STRIPE TRANSFER ST-N4KD9QX",
      });
    }

    // --- Financing: NOT revenue --------------------------------------------
    for (const round of profile.financing) {
      if (round.month !== i) continue;
      tx({
        account_id: operating,
        type: "wire_in",
        amount: round.amount,
        initiated_at: at(y, m, round.day, 11),
        counterparty_name: round.counterparty,
        memo: round.memo,
        note: round.note,
      });
    }

    // --- Payroll -----------------------------------------------------------
    // Headcount grows over time; each run is half the month's payroll.
    const payrollBase = dollars(profile.payroll.base + i * profile.payroll.growth);
    for (const day of [15, maxDay >= 28 ? 28 : maxDay]) {
      if (day > maxDay) continue;
      tx({
        account_id: operating,
        type: "ach_debit",
        amount: -jitter(payrollBase, 0.04),
        initiated_at: at(y, m, day, 13),
        counterparty_name: "Gusto Payroll",
        memo: "ACH DEBIT GUSTO PAYROLL RUN",
        user: USERS[2],
      });
    }

    // --- Fixed operating costs --------------------------------------------
    if (maxDay >= 2) {
      tx({
        account_id: operating,
        type: "ach_debit",
        amount: -profile.rent.amount,
        initiated_at: at(y, m, 2, 10),
        counterparty_name: profile.rent.counterparty,
        memo: profile.rent.memo,
      });
    }
    if (maxDay >= 6) {
      tx({
        account_id: card,
        type: "card_debit",
        amount: -jitter(dollars(profile.cloud.base + i * profile.cloud.growth), 0.12),
        initiated_at: at(y, m, 6, 8),
        counterparty_name: profile.cloud.counterparty,
        memo: profile.cloud.memo,
        card_id: CARDS[3].id,
        card_name: CARDS[3].name,
        user: USERS[3],
      });
    }

    // --- Discretionary card spend -----------------------------------------
    const swipes = randInt(profile.swipes.min, profile.swipes.max);
    for (let s = 0; s < swipes; s++) {
      const day = randInt(1, maxDay);
      const merchant = pick(SAAS_MERCHANTS)[0];
      const chosen = pick(CARDS);
      const amount = -dollars(randInt(29, 2_400));
      // Recent swipes are still pending.
      const pending = isCurrent && day >= maxDay - 3;
      tx({
        account_id: card,
        type: "card_debit",
        amount,
        initiated_at: at(y, m, day, randInt(7, 21)),
        counterparty_name: merchant,
        memo: merchant.toUpperCase(),
        status: pending ? "pending" : "settled",
        settle_days: 2,
        card_id: chosen.id,
        card_name: chosen.name,
        user: chosen.cardholder,
      });
    }

    // --- Contractors abroad, with the fee as its own row ------------------
    if (maxDay >= 20) {
      const mm = nextMmId();
      tx({
        account_id: operating,
        type: "international_wire_out",
        amount: -jitter(profile.contractor.amount, 0.1),
        initiated_at: at(y, m, 20, 12),
        counterparty_name: profile.contractor.counterparty,
        memo: profile.contractor.memo,
        money_movement_id: mm,
        user: USERS[1],
      });
      tx({
        account_id: operating,
        type: "international_wire_fee",
        amount: -dollars(45),
        initiated_at: at(y, m, 20, 12),
        counterparty_name: "Rho Bank",
        memo: "INTL WIRE FEE",
        money_movement_id: mm,
      });
    }

    // --- Related-party outflow, mirroring a customer's inbound ------------
    const related = profile.relatedParty;
    const relatedCustomer = related && CUSTOMERS.find((c) => c.id === related.customerId)!;
    if (related && relatedCustomer && i >= relatedCustomer.start_month && maxDay >= 24) {
      tx({
        account_id: operating,
        type: "wire_out",
        amount: -related.amount,
        initiated_at: at(y, m, 24, 14),
        counterparty_name: relatedCustomer.legal_name,
        memo: related.memo,
        user: USERS[0],
      });
    }

    // --- Corporate card repayment: two legs, one money movement -----------
    if (maxDay >= 10 && i > 0) {
      const owed = txns
        .filter(
          (t) =>
            t.account_id === card &&
            t.transaction_type === "card_debit" &&
            t.status === "settled" &&
            Date.parse(t.initiated_at) < Date.UTC(y, m, 1),
        )
        .reduce((sum, t) => sum + t.amount.amount, 0);
      const repaid = txns
        .filter((t) => t.account_id === card && t.transaction_type === "credit_repayment")
        .reduce((sum, t) => sum + t.amount.amount, 0);
      const due = -(owed + repaid);
      if (due > 0) {
        const mm = nextMmId();
        tx({
          account_id: operating,
          type: "credit_repayment",
          amount: -due,
          initiated_at: at(y, m, 10, 16),
          counterparty_name: "Rho Corporate Card",
          memo: "CARD AUTOPAY STATEMENT BALANCE",
          money_movement_id: mm,
        });
        tx({
          account_id: card,
          type: "credit_repayment",
          amount: due,
          initiated_at: at(y, m, 10, 16),
          counterparty_name: "Rho Corporate Card",
          memo: "STATEMENT PAYMENT RECEIVED",
          money_movement_id: mm,
        });
      }
    }

    // --- Treasury sweep: both legs share a money_movement_id --------------
    if (i >= profile.treasurySweep.fromMonth && i % 3 === 0 && maxDay >= 27) {
      const mm = nextMmId();
      const sweep = profile.treasurySweep.amount;
      tx({
        account_id: operating,
        type: "internal_transfer",
        amount: -sweep,
        initiated_at: at(y, m, 27, 10),
        counterparty_name: accountName(treasury),
        memo: "INTERNAL TRANSFER TO TREASURY",
        money_movement_id: mm,
        user: USERS[0],
      });
      tx({
        account_id: treasury,
        type: "treasury_deposit",
        amount: sweep,
        initiated_at: at(y, m, 27, 10),
        counterparty_name: accountName(operating),
        memo: "TREASURY DEPOSIT",
        money_movement_id: mm,
      });
    }

    // --- Non-revenue inflows ----------------------------------------------
    if (maxDay >= 28) {
      tx({
        account_id: savings,
        type: "savings_interest",
        amount: dollars(randInt(120, 310)),
        initiated_at: at(y, m, 28, 6),
        counterparty_name: "Rho Bank",
        memo: "INTEREST PAID",
      });
      const treasuryBal = txns
        .filter((t) => t.account_id === treasury)
        .reduce((s, t) => s + t.amount.amount, 0);
      if (treasuryBal > 0) {
        tx({
          account_id: treasury,
          type: "treasury_interest",
          amount: Math.round(treasuryBal * 0.0037),
          initiated_at: at(y, m, 28, 6),
          counterparty_name: "Rho Treasury",
          memo: "MONEY MARKET YIELD",
        });
      }
      tx({
        account_id: rewards,
        type: "rewards_accrual",
        amount: dollars(randInt(180, 640)),
        initiated_at: at(y, m, 28, 6),
        counterparty_name: "Rho Rewards",
        memo: "POINTS ACCRUAL",
      });
    }

    // --- Occasional refunds and reversals ---------------------------------
    if (rng() < 0.3 && maxDay >= 17) {
      tx({
        account_id: card,
        type: "card_refund",
        amount: dollars(randInt(60, 900)),
        initiated_at: at(y, m, 17, 11),
        counterparty_name: pick(SAAS_MERCHANTS)[0],
        memo: "REFUND",
        card_id: CARDS[0].id,
        card_name: CARDS[0].name,
      });
    }
  }

  // --- One-off edge cases ----------------------------------------------------
  profile.oneOffs?.({ tx, nextMmId, users: USERS });

  txns.sort((a, b) => Date.parse(a.initiated_at) - Date.parse(b.initiated_at));

  // --- Invoices ------------------------------------------------------------
  let invSeq = 0;
  const paidInvoices = invoiceSeeds
    .sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt))
    .map((seed) => {
      const n = ++invSeq;
      const issued = addDays(seed.paidAt, -randInt(3, 10));
      const unit = Math.round(seed.cents / seed.months);
      return {
        id: `inv_${String(n).padStart(5, "0")}`,
        invoice_number: `${profile.invoicePrefix}-${String(1000 + n)}`,
        status: "paid",
        date: issued,
        due_date: addDays(issued, 30),
        note: "Thanks for your business.",
        customer: { id: seed.customer.id },
        total: usd(seed.cents),
        tax_rate: 0,
        discount_rate: 0,
        line_items: [
          {
            name:
              seed.months === 12
                ? `${profile.productName} — Annual Subscription`
                : `${profile.productName} — Monthly Subscription`,
            unit_price: usd(unit),
            quantity: seed.months,
            discount_rate: null,
            tax_rate: null,
            total: usd(seed.cents),
          },
        ],
        payments: [
          {
            type: "received_in_account",
            external_method: null,
            paid_at: seed.paidAt,
            transaction_id: seed.txnId,
          },
        ],
        activities: [
          { activity_type: "created", created_at: issued, user_id: "usr_ops", emails: [] },
          { activity_type: "sent", created_at: addDays(issued, 1), user_id: "usr_ops", emails: [seed.customer.email] },
          { activity_type: "paid", created_at: seed.paidAt, user_id: null, emails: [] },
        ],
        file_id: `file_inv_${String(n).padStart(5, "0")}`,
        accounting_sync_status: "synced",
        accounting_synced_at: addDays(seed.paidAt, 1),
        created_at: issued,
        updated_at: seed.paidAt,
      };
    });

  // Unpaid invoices draw nothing from the RNG, so adding them to a profile
  // never disturbs the rest of its ledger.
  const unpaidInvoices = (profile.unpaidInvoices ?? []).map((unpaid) => {
    const n = ++invSeq;
    const customer = CUSTOMERS.find((c) => c.id === unpaid.customerId)!;
    const overdue = Date.parse(unpaid.dueAt) < Date.parse(ANCHOR);
    return {
      id: `inv_${String(n).padStart(5, "0")}`,
      invoice_number: `${profile.invoicePrefix}-${String(1000 + n)}`,
      status: overdue ? "overdue" : "unpaid",
      date: unpaid.issuedAt,
      due_date: unpaid.dueAt,
      note: "Thanks for your business.",
      customer: { id: customer.id },
      total: usd(unpaid.amount),
      tax_rate: 0,
      discount_rate: 0,
      line_items: [
        {
          name: `${profile.productName} — Monthly Subscription`,
          unit_price: usd(unpaid.amount),
          quantity: 1,
          discount_rate: null,
          tax_rate: null,
          total: usd(unpaid.amount),
        },
      ],
      payments: [] as never[],
      activities: [
        { activity_type: "created", created_at: unpaid.issuedAt, user_id: "usr_ops", emails: [] },
        { activity_type: "sent", created_at: addDays(unpaid.issuedAt, 1), user_id: "usr_ops", emails: [customer.email] },
      ],
      file_id: `file_inv_${String(n).padStart(5, "0")}`,
      accounting_sync_status: "synced",
      accounting_synced_at: addDays(unpaid.issuedAt, 1),
      created_at: unpaid.issuedAt,
      updated_at: unpaid.issuedAt,
    };
  });
  const invoices = [...paidInvoices, ...unpaidInvoices];

  const customers = CUSTOMERS.map((c) => {
    const mine = paidInvoices.filter((inv) => inv.customer.id === c.id);
    const revenue = mine.reduce((s, inv) => s + inv.total.amount, 0);
    const first = mine[0];
    const last = mine[mine.length - 1];
    return {
      id: c.id,
      legal_name: c.legal_name,
      email: c.email,
      address: {
        address1: `${randInt(100, 9800)} ${pick(["Market", "Oak", "Lincoln", "Harbor", "Chestnut", "Grand"])} St`,
        address2: rng() < 0.4 ? `Suite ${randInt(100, 900)}` : "",
        city: c.city,
        state: c.state,
        zip_code: String(randInt(10_000, 99_999)),
        country: "US",
      },
      note: c.trait === "related_party" && profile.relatedParty ? profile.relatedParty.customerNote : "",
      cc_emails: [] as string[],
      total_revenue: usd(revenue),
      last_invoice_id: last?.id ?? null,
      created_at: first?.created_at ?? ANCHOR,
      updated_at: last?.updated_at ?? ANCHOR,
      deleted_at: null,
    };
  });

  // --- Balances --------------------------------------------------------------
  // Derived from the ledger, so cash on hand reconciles with the transactions
  // served. Pending and failed rows do not move a balance.
  const accounts = ACCOUNTS.map((a) => {
    const settled = txns
      .filter((t) => t.account_id === a.id && t.status === "settled")
      .reduce((s, t) => s + t.amount.amount, 0);
    return {
      id: a.id,
      account_type: a.account_type,
      balance: usd(a.opening_cents + settled),
      account_name: a.account_name,
      account_number_last_4: a.account_number_last_4,
      ...(a.routing_number_last_4 ? { routing_number_last_4: a.routing_number_last_4 } : {}),
    };
  });

  const meta = {
    generator: "scripts/generate-rho-fixtures.ts",
    seed: profile.seed,
    anchor: ANCHOR,
    company: profile.legalName,
    slug: profile.slug,
    short_name: profile.shortName,
    description: profile.description,
    mock_token: mockTokenFor(profile.slug),
    ...(profile.realCustomers ? { real_customers: true } : {}),
    ...(profile.tokenOnly ? { token_only: true } : {}),
    period: { first_month: "2025-04", last_month: "2026-09" },
    counts: {
      accounts: accounts.length,
      transactions: txns.length,
      cards: CARDS.length,
      customers: customers.length,
      invoices: invoices.length,
    },
    opening_balances: Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.opening_cents])),
  };

  return { accounts, transactions: txns, cards: CARDS, customers, invoices, meta };
}

// ----------------------------------------------------------------- profiles

const STANDARD_ACCOUNTS = (last4: [string, string, string, string, string], opening: [number, number]) =>
  [
    { id: "acc_checking_main", account_type: "checking", suffix: "Operating", account_number_last_4: last4[0], routing_number_last_4: "0021", opening_cents: opening[0] },
    { id: "acc_savings_reserve", account_type: "savings", suffix: "Reserve", account_number_last_4: last4[1], routing_number_last_4: "0021", opening_cents: opening[1] },
    { id: "acc_treasury_mmf", account_type: "investment", suffix: "Treasury", account_number_last_4: last4[2], opening_cents: 0 },
    { id: "acc_credit_card", account_type: "credit", suffix: "Corporate Card", account_number_last_4: last4[3], opening_cents: 0 },
    { id: "acc_rewards", account_type: "rewards", suffix: "Rewards", account_number_last_4: last4[4], opening_cents: 0 },
  ] satisfies CompanyProfile["accounts"];

const NORTHSTAR: CompanyProfile = {
  slug: "northstar-labs",
  legalName: "Northstar Labs, Inc.",
  shortName: "Northstar Labs",
  description: "Operations analytics for mid-market logistics and healthcare teams.",
  seed: 20260912,
  invoicePrefix: "NS",
  productName: "Northstar Platform",
  users: [
    { user_id: "usr_founder", first_name: "Dana", last_name: "Whitfield" },
    { user_id: "usr_cofounder", first_name: "Marcus", last_name: "Olegun" },
    { user_id: "usr_ops", first_name: "Priya", last_name: "Raman" },
    { user_id: "usr_eng", first_name: "Sam", last_name: "Okafor" },
  ],
  billingAddress: { street: "1100 Congress Ave, Suite 400", city: "Austin", subdivision: "TX", postal_code: "78701" },
  accounts: STANDARD_ACCOUNTS(["4417", "8830", "5512", "9074", "0001"], [dollars(184_920), dollars(50_000)]),
  customers: [
    // Concentration risk: ends up ~25-30% of invoiced revenue.
    { id: "cus_0001", legal_name: "Corvus Systems, Inc.", email: "ap@corvussystems.com", city: "Austin", state: "TX", pay_day: 3, start_month: 0, end_month: 17, cents: dollars(18_500), expands_at: 10, expands_to: dollars(24_000), cadence: "monthly", invoiced: true },
    { id: "cus_0002", legal_name: "Meridian Health Group LLC", email: "billing@meridianhealthgrp.com", city: "Chicago", state: "IL", pay_day: 5, start_month: 0, end_month: 17, cents: dollars(9_200), expands_at: 8, expands_to: dollars(12_400), cadence: "monthly", invoiced: true },
    // Churn: stops paying after month 9.
    { id: "cus_0003", legal_name: "Ferry Logistics Co.", email: "accounts@ferrylogistics.com", city: "Newark", state: "NJ", pay_day: 8, start_month: 0, end_month: 9, cents: dollars(6_800), cadence: "monthly", invoiced: true },
    // Annual prepayment: one lump sum covering 12 months. Naive MRR math breaks here.
    { id: "cus_0004", legal_name: "Atlas Freight Partners", email: "finance@atlasfreight.com", city: "Memphis", state: "TN", pay_day: 12, start_month: 4, end_month: 17, cents: dollars(96_000), cadence: "annual", invoiced: true },
    { id: "cus_0005", legal_name: "Bellweather Foods Inc.", email: "ap@bellweatherfoods.com", city: "Portland", state: "OR", pay_day: 14, start_month: 1, end_month: 17, cents: dollars(4_500), cadence: "monthly", invoiced: true },
    { id: "cus_0006", legal_name: "Kestrel Robotics", email: "ap@kestrelrobotics.io", city: "Boston", state: "MA", pay_day: 6, start_month: 2, end_month: 17, cents: dollars(7_300), cadence: "monthly", invoiced: true },
    { id: "cus_0007", legal_name: "Pinnacle Dental Partners", email: "billing@pinnacledental.com", city: "Phoenix", state: "AZ", pay_day: 18, start_month: 5, end_month: 17, cents: dollars(3_200), cadence: "monthly", invoiced: true },
    { id: "cus_0008", legal_name: "Orchid Bio Sciences", email: "ap@orchidbio.com", city: "San Diego", state: "CA", pay_day: 21, start_month: 6, end_month: 17, cents: dollars(5_400), cadence: "monthly", invoiced: true },
    { id: "cus_0009", legal_name: "Tanager Media Group", email: "finance@tanagermedia.com", city: "Brooklyn", state: "NY", pay_day: 9, start_month: 7, end_month: 17, cents: dollars(2_900), cadence: "monthly", invoiced: true },
    { id: "cus_0010", legal_name: "Vireo Energy Solutions", email: "ap@vireoenergy.com", city: "Denver", state: "CO", pay_day: 16, start_month: 9, end_month: 17, cents: dollars(11_000), cadence: "monthly", invoiced: true },
    { id: "cus_0011", legal_name: "Halcyon Legal LLP", email: "accounts@halcyonlegal.com", city: "Seattle", state: "WA", pay_day: 22, start_month: 11, end_month: 17, cents: dollars(4_100), cadence: "monthly", invoiced: true },
    { id: "cus_0012", legal_name: "Sandpiper Retail Group", email: "ap@sandpiperretail.com", city: "Atlanta", state: "GA", pay_day: 11, start_month: 12, end_month: 17, cents: dollars(6_250), cadence: "monthly", invoiced: true },
    // Related party: pays us $8.5k/mo while we wire them $9k/mo for "advisory".
    { id: "cus_0013", legal_name: "Quill & Stone LLC", email: "dana@quillandstone.co", city: "Austin", state: "TX", pay_day: 2, start_month: 3, end_month: 17, cents: dollars(8_500), cadence: "monthly", invoiced: true, trait: "related_party" },
    // Unverifiable: perfectly round, same day, no invoice, no web footprint.
    { id: "cus_0014", legal_name: "Cobalt Holdings Group", email: "admin@cobaltholdingsgrp.net", city: "Dover", state: "DE", pay_day: 1, start_month: 4, end_month: 17, cents: dollars(10_000), cadence: "monthly", invoiced: false, trait: "unverifiable" },
    { id: "cus_0015", legal_name: "Northgate Logistics", email: "ap@northgatelogistics.com", city: "Columbus", state: "OH", pay_day: 25, start_month: 14, end_month: 17, cents: dollars(3_750), cadence: "monthly", invoiced: true },
  ],
  selfServe: { weeklyStart: 1_800, weeklyGrowth: 260 },
  financing: [
    { month: 2, day: 19, amount: dollars(2_500_000), counterparty: "Harborline Ventures II LP", memo: "WIRE IN SEED PREFERRED SERIES SEED CLOSING", note: "Seed round close" },
    { month: 11, day: 7, amount: dollars(750_000), counterparty: "Harborline Ventures II LP", memo: "WIRE IN SAFE NOTE BRIDGE", note: "Bridge SAFE" },
  ],
  payroll: { base: 38_000, growth: 4_200 },
  rent: { amount: dollars(12_400), counterparty: "WeWork Congress Ave", memo: "ACH DEBIT WEWORK OFFICE LEASE" },
  cloud: { base: 8_200, growth: 640, counterparty: "Amazon Web Services", memo: "AWS EMEA CLOUD SERVICES" },
  swipes: { min: 9, max: 15 },
  contractor: { amount: dollars(14_500), counterparty: "Lindgren Design AB", memo: "INTL WIRE OUT DESIGN RETAINER" },
  relatedParty: { customerId: "cus_0013", amount: dollars(9_000), memo: "WIRE OUT ADVISORY SERVICES", customerNote: "Advisory partner — see Dana" },
  treasurySweep: { amount: dollars(250_000), fromMonth: 3 },
  oneOffs: ({ tx, nextMmId, users }) => {
    // A vendor ACH that bounced back — the debit and its return share a movement id.
    const mm = nextMmId();
    tx({ account_id: "acc_checking_main", type: "ach_debit", amount: -dollars(6_400), initiated_at: "2026-02-09T16:12:00.000Z", counterparty_name: "Palmer Creative Studio", memo: "ACH DEBIT VENDOR INVOICE 2291", money_movement_id: mm });
    tx({ account_id: "acc_checking_main", type: "ach_return", amount: dollars(6_400), initiated_at: "2026-02-12T16:12:00.000Z", counterparty_name: "Palmer Creative Studio", memo: "ACH RETURN R01 INSUFFICIENT FUNDS", money_movement_id: mm, note: "Vendor account closed, reissued by wire" });
    // A failed outbound — must never count toward burn.
    tx({ account_id: "acc_checking_main", type: "ach_debit", amount: -dollars(3_200), initiated_at: "2026-05-21T15:03:00.000Z", counterparty_name: "Cedar Park Utilities", memo: "ACH DEBIT UTILITIES", status: "failed" });
    // An outbound wire still awaiting approval as of the anchor date.
    tx({ account_id: "acc_checking_main", type: "wire_out", amount: -dollars(18_000), initiated_at: "2026-09-10T17:41:00.000Z", counterparty_name: "Ridgeway Compliance Advisors", memo: "WIRE OUT SOC2 AUDIT", status: "awaiting_approval", user: users[1] });
    // A customer refund: revenue that must be netted back out.
    tx({ account_id: "acc_checking_main", type: "ach_debit", amount: -dollars(4_500), initiated_at: "2026-04-18T15:22:00.000Z", counterparty_name: "Bellweather Foods Inc.", memo: "ACH DEBIT CUSTOMER CREDIT MEMO", note: "Partial refund, service credit" });
    // A check deposit from a customer who pays offline.
    tx({ account_id: "acc_checking_main", type: "check_deposit", amount: dollars(7_500), initiated_at: "2026-06-03T14:05:00.000Z", counterparty_name: "Larkspur Municipal District", memo: "CHECK DEPOSIT 10482", settle_days: 3 });
  },
};

/*
 * Acme AI — the headline demo company. Month indices run from 0 (April 2025) to
 * 17 (September 2026); the monthly receipt reports on month 16, August 2026.
 */
const ACME: CompanyProfile = {
  slug: "acme-ai",
  legalName: "Acme AI, Inc.",
  shortName: "Acme AI",
  description: "Document intelligence models for insurance and healthcare claims.",
  seed: 20240417,
  invoicePrefix: "AC",
  productName: "Acme Extract",
  users: [
    { user_id: "usr_founder", first_name: "Leah", last_name: "Okonkwo" },
    { user_id: "usr_cofounder", first_name: "Tomas", last_name: "Reyes" },
    { user_id: "usr_ops", first_name: "Hana", last_name: "Mori" },
    { user_id: "usr_eng", first_name: "Devin", last_name: "Clarke" },
  ],
  billingAddress: { street: "535 Mission St, Floor 14", city: "San Francisco", subdivision: "CA", postal_code: "94105" },
  accounts: STANDARD_ACCOUNTS(["2290", "6614", "3087", "7731", "0002"], [dollars(96_000), dollars(25_000)]),
  customers: [
    // The concentration risk: roughly a third of revenue once it expands.
    { id: "cus_0101", legal_name: "Tessellate Health, Inc.", email: "ap@tessellatehealth.com", city: "Nashville", state: "TN", pay_day: 3, start_month: 6, end_month: 17, cents: dollars(9_000), expands_at: 12, expands_to: dollars(14_800), cadence: "monthly", invoiced: true },
    { id: "cus_0102", legal_name: "Halberd Genomics", email: "finance@halberdgenomics.com", city: "Cambridge", state: "MA", pay_day: 5, start_month: 4, end_month: 17, cents: dollars(6_200), expands_at: 15, expands_to: dollars(8_400), cadence: "monthly", invoiced: true },
    { id: "cus_0103", legal_name: "Parlour Commerce Co.", email: "billing@parlourcommerce.com", city: "Chicago", state: "IL", pay_day: 7, start_month: 8, end_month: 17, cents: dollars(6_200), cadence: "monthly", invoiced: true },
    // Pays monthly, but August's invoice is overdue — the monthly receipt's flag.
    { id: "cus_0104", legal_name: "Driftwood Logistics", email: "ap@driftwoodlogistics.com", city: "Savannah", state: "GA", pay_day: 26, start_month: 10, end_month: 17, cents: dollars(3_900), cadence: "monthly", invoiced: true, skip_months: [16] },
    // Churned after five months.
    { id: "cus_0105", legal_name: "Fernhill Studios", email: "accounts@fernhillstudios.com", city: "Austin", state: "TX", pay_day: 12, start_month: 7, end_month: 11, cents: dollars(2_000), cadence: "monthly", invoiced: true },
    { id: "cus_0106", legal_name: "Saltmarsh Energy", email: "ap@saltmarshenergy.com", city: "Houston", state: "TX", pay_day: 14, start_month: 14, end_month: 17, cents: dollars(2_800), cadence: "monthly", invoiced: true },
    { id: "cus_0107", legal_name: "Copperline Retail", email: "finance@copperlineretail.com", city: "Denver", state: "CO", pay_day: 18, start_month: 15, end_month: 17, cents: dollars(3_400), cadence: "monthly", invoiced: true },
    { id: "cus_0108", legal_name: "Lumenfold Insurance", email: "ap@lumenfoldins.com", city: "Hartford", state: "CT", pay_day: 21, start_month: 15, end_month: 17, cents: dollars(2_600), cadence: "monthly", invoiced: true },
    // First paid in August 2026 — the monthly receipt's "new customer".
    { id: "cus_0109", legal_name: "Kittiwake Systems", email: "ap@kittiwakesystems.com", city: "Portland", state: "ME", pay_day: 9, start_month: 16, end_month: 17, cents: dollars(4_500), cadence: "monthly", invoiced: true },
    // Pays without invoices — needs review.
    { id: "cus_0110", legal_name: "Greyfield Trading LLC", email: "office@greyfieldtrading.net", city: "Wilmington", state: "DE", pay_day: 1, start_month: 12, end_month: 17, cents: dollars(3_100), cadence: "monthly", invoiced: false, trait: "unverifiable" },
  ],
  selfServe: { weeklyStart: 450, weeklyGrowth: 95 },
  financing: [
    { month: 1, day: 22, amount: dollars(1_600_000), counterparty: "Sparrowhawk Capital Fund I LP", memo: "WIRE IN SEED PREFERRED CLOSING", note: "Seed round" },
    { month: 12, day: 9, amount: dollars(700_000), counterparty: "Sparrowhawk Capital Fund I LP", memo: "WIRE IN SEED EXTENSION SAFE", note: "Seed extension" },
  ],
  payroll: { base: 24_000, growth: 1_150 },
  rent: { amount: dollars(6_800), counterparty: "Mission Street Studios", memo: "ACH DEBIT OFFICE LEASE" },
  cloud: { base: 7_500, growth: 820, counterparty: "Lambda GPU Cloud", memo: "LAMBDA GPU COMPUTE" },
  swipes: { min: 8, max: 13 },
  contractor: { amount: dollars(7_800), counterparty: "Vasquez Annotation SRL", memo: "INTL WIRE OUT DATA LABELLING" },
  treasurySweep: { amount: dollars(150_000), fromMonth: 12 },
  unpaidInvoices: [
    // Issued late July, due 25 August, still unpaid at the anchor: 18 days overdue.
    { customerId: "cus_0104", amount: dollars(3_900), issuedAt: "2026-07-26T15:00:00.000Z", dueAt: "2026-08-25T15:00:00.000Z" },
  ],
};

/*
 * Two fictional startups whose customers and vendors are real businesses, so live
 * Tavily and OpenAI research has real companies to verify. Their ledgers are as
 * synthetic as Acme's: every amount, invoice and relationship is invented.
 */
const QUIVERLEAF: CompanyProfile = {
  slug: "quiverleaf-ai",
  realCustomers: true,
  tokenOnly: true,
  legalName: "Quiverleaf AI, Inc.",
  shortName: "Quiverleaf AI",
  description: "Procurement copilot that audits software spend for product and engineering teams.",
  seed: 20250601,
  invoicePrefix: "QL",
  productName: "Quiverleaf Procure",
  users: [
    { user_id: "usr_founder", first_name: "Imani", last_name: "Castellanos" },
    { user_id: "usr_cofounder", first_name: "Felix", last_name: "Haugen" },
    { user_id: "usr_ops", first_name: "Ruth", last_name: "Adeyemi" },
    { user_id: "usr_eng", first_name: "Omar", last_name: "Lindqvist" },
  ],
  billingAddress: { street: "548 Market St, Suite 3100", city: "San Francisco", subdivision: "CA", postal_code: "94104" },
  accounts: STANDARD_ACCOUNTS(["3318", "7402", "1559", "6620", "0003"], [dollars(140_000), dollars(40_000)]),
  customers: [
    // The concentration risk once it expands.
    { id: "cus_0201", legal_name: "Notion Labs, Inc.", email: "billing@notion.so", city: "San Francisco", state: "CA", pay_day: 4, start_month: 2, end_month: 17, cents: dollars(8_000), expands_at: 12, expands_to: dollars(13_500), cadence: "monthly", invoiced: true },
    { id: "cus_0202", legal_name: "Figma, Inc.", email: "ap@figma.com", city: "San Francisco", state: "CA", pay_day: 6, start_month: 4, end_month: 17, cents: dollars(6_200), cadence: "monthly", invoiced: true },
    { id: "cus_0203", legal_name: "Vercel Inc.", email: "billing@vercel.com", city: "San Francisco", state: "CA", pay_day: 9, start_month: 6, end_month: 17, cents: dollars(4_800), cadence: "monthly", invoiced: true },
    // August's invoice is overdue.
    { id: "cus_0204", legal_name: "Retool, Inc.", email: "ap@retool.com", city: "San Francisco", state: "CA", pay_day: 26, start_month: 8, end_month: 17, cents: dollars(3_900), cadence: "monthly", invoiced: true, skip_months: [16] },
    // The legal name differs from the brand on its site (Linear): a hard identity match.
    { id: "cus_0205", legal_name: "Linear Orbit, Inc.", email: "finance@linear.app", city: "San Francisco", state: "CA", pay_day: 12, start_month: 10, end_month: 17, cents: dollars(3_200), cadence: "monthly", invoiced: true },
    // A non-US entity.
    { id: "cus_0206", legal_name: "Canva Pty Ltd", email: "accounts@canva.com", city: "Sydney", state: "NSW", pay_day: 15, start_month: 13, end_month: 17, cents: dollars(5_600), cadence: "monthly", invoiced: true },
    // Churned after seven months.
    { id: "cus_0207", legal_name: "Pitch Software GmbH", email: "billing@pitch.com", city: "Berlin", state: "BE", pay_day: 19, start_month: 3, end_month: 9, cents: dollars(2_000), cadence: "monthly", invoiced: true },
    // Pays without invoices: counted from a name match, then researched live.
    { id: "cus_0208", legal_name: "Webflow, Inc.", email: "finance@webflow.com", city: "San Francisco", state: "CA", pay_day: 1, start_month: 11, end_month: 17, cents: dollars(2_500), cadence: "monthly", invoiced: false, trait: "unverifiable" },
  ],
  selfServe: { weeklyStart: 600, weeklyGrowth: 70 },
  financing: [
    { month: 1, day: 14, amount: dollars(2_000_000), counterparty: "Bayrock Ridge Partners II LP", memo: "WIRE IN SEED PREFERRED CLOSING", note: "Seed round" },
  ],
  payroll: { base: 30_000, growth: 1_500 },
  rent: { amount: dollars(9_200), counterparty: "WeWork", memo: "ACH DEBIT WEWORK 600 CALIFORNIA ST" },
  cloud: { base: 5_200, growth: 380, counterparty: "Amazon Web Services", memo: "AWS CLOUD SERVICES" },
  swipes: { min: 8, max: 12 },
  contractor: { amount: dollars(9_500), counterparty: "Toptal", memo: "ACH DEBIT TOPTAL CONTRACT ENGINEERING" },
  treasurySweep: { amount: dollars(150_000), fromMonth: 12 },
  unpaidInvoices: [
    { customerId: "cus_0204", amount: dollars(3_900), issuedAt: "2026-07-27T15:00:00.000Z", dueAt: "2026-08-26T15:00:00.000Z" },
  ],
};

const LANTERNFISH: CompanyProfile = {
  slug: "lanternfish-analytics",
  realCustomers: true,
  tokenOnly: true,
  legalName: "Lanternfish Analytics, Inc.",
  shortName: "Lanternfish Analytics",
  description: "Demand forecasting for direct-to-consumer retail brands.",
  seed: 20250815,
  invoicePrefix: "LF",
  productName: "Lanternfish Forecast",
  users: [
    { user_id: "usr_founder", first_name: "Nadia", last_name: "Brennan-Soto" },
    { user_id: "usr_cofounder", first_name: "Kwame", last_name: "Ostrowski" },
    { user_id: "usr_ops", first_name: "Elena", last_name: "Vasquez-Hart" },
    { user_id: "usr_eng", first_name: "Jun", last_name: "Abernathy" },
  ],
  billingAddress: { street: "250 Greenwich St, Floor 46", city: "New York", subdivision: "NY", postal_code: "10007" },
  accounts: STANDARD_ACCOUNTS(["5021", "8193", "2744", "4406", "0004"], [dollars(210_000), dollars(60_000)]),
  customers: [
    { id: "cus_0301", legal_name: "Allbirds, Inc.", email: "ap@allbirds.com", city: "San Francisco", state: "CA", pay_day: 3, start_month: 0, end_month: 17, cents: dollars(9_500), expands_at: 9, expands_to: dollars(12_000), cadence: "monthly", invoiced: true },
    { id: "cus_0302", legal_name: "Warby Parker Inc.", email: "ap@warbyparker.com", city: "New York", state: "NY", pay_day: 5, start_month: 1, end_month: 17, cents: dollars(7_800), cadence: "monthly", invoiced: true },
    { id: "cus_0303", legal_name: "Glossier, Inc.", email: "billing@glossier.com", city: "New York", state: "NY", pay_day: 8, start_month: 3, end_month: 17, cents: dollars(5_400), cadence: "monthly", invoiced: true },
    { id: "cus_0304", legal_name: "Brooklinen, Inc.", email: "finance@brooklinen.com", city: "Brooklyn", state: "NY", pay_day: 11, start_month: 5, end_month: 17, cents: dollars(3_600), cadence: "monthly", invoiced: true },
    // An annual prepayment, spread across twelve months.
    { id: "cus_0305", legal_name: "Bombas LLC", email: "ap@bombas.com", city: "New York", state: "NY", pay_day: 14, start_month: 4, end_month: 17, cents: dollars(54_000), cadence: "annual", invoiced: true },
    // Churned after six months.
    { id: "cus_0306", legal_name: "Parachute Home, Inc.", email: "ap@parachutehome.com", city: "Los Angeles", state: "CA", pay_day: 17, start_month: 7, end_month: 12, cents: dollars(2_900), cadence: "monthly", invoiced: true },
    { id: "cus_0307", legal_name: "Outdoor Voices, Inc.", email: "ap@outdoorvoices.com", city: "Austin", state: "TX", pay_day: 21, start_month: 14, end_month: 17, cents: dollars(2_200), cadence: "monthly", invoiced: true },
    // Pays without invoices: counted from a name match, then researched live.
    { id: "cus_0308", legal_name: "Rothy's, Inc.", email: "accounts@rothys.com", city: "San Francisco", state: "CA", pay_day: 1, start_month: 10, end_month: 17, cents: dollars(3_000), cadence: "monthly", invoiced: false, trait: "unverifiable" },
  ],
  selfServe: { weeklyStart: 900, weeklyGrowth: 110 },
  financing: [
    { month: 0, day: 28, amount: dollars(3_200_000), counterparty: "Greyline Ventures III LP", memo: "WIRE IN SERIES A PREFERRED CLOSING", note: "Series A" },
  ],
  payroll: { base: 42_000, growth: 2_000 },
  rent: { amount: dollars(14_800), counterparty: "WeWork", memo: "ACH DEBIT WEWORK 115 BROADWAY" },
  cloud: { base: 6_900, growth: 450, counterparty: "Google Cloud", memo: "GOOGLE CLOUD PLATFORM" },
  swipes: { min: 10, max: 14 },
  contractor: { amount: dollars(11_000), counterparty: "Deel", memo: "ACH DEBIT DEEL CONTRACTOR PAYROLL" },
  treasurySweep: { amount: dollars(200_000), fromMonth: 6 },
};

// ------------------------------------------------------------------- output

for (const profile of [NORTHSTAR, ACME, QUIVERLEAF, LANTERNFISH]) {
  const data = generateCompany(profile);
  const dir = join(FIXTURES_DIR, profile.slug);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");

  write("accounts.json", data.accounts);
  write("transactions.json", data.transactions);
  write("cards.json", data.cards);
  write("customers.json", data.customers);
  write("invoices.json", data.invoices);
  write("meta.json", data.meta);

  const cash = data.accounts
    .filter((a) => a.account_type !== "credit" && a.account_type !== "rewards")
    .reduce((s, a) => s + a.balance.amount, 0);
  console.log(
    `${profile.shortName.padEnd(16)} ${String(data.transactions.length).padStart(4)} transactions  ` +
      `${String(data.invoices.length).padStart(3)} invoices  cash $${(cash / 100).toLocaleString("en-US")}`,
  );
}
