/**
 * Deterministic Rho API fixture generator.
 *
 *   node scripts/generate-rho-fixtures.ts
 *
 * Writes src/lib/rho/fixtures/*.json — the dataset the mock Rho API serves.
 *
 * Determinism is the whole point: a fixed seed and a fixed ANCHOR date mean the
 * metric engine can be tested against golden values that never drift. Nothing
 * here calls Date.now(). Regenerating with the same seed reproduces the file
 * byte for byte.
 *
 * The dataset models "Northstar Labs, Inc." — a seed-stage B2B SaaS company —
 * over 18 months, and deliberately plants every case that can corrupt a metric:
 * internal transfers, a priced round landing as revenue-shaped inflow, an annual
 * prepayment, churn, expansion, an aggregated Stripe payout, a related-party
 * circular flow, an unverifiable customer, refunds, and non-settled rows.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "rho",
  "fixtures",
);

/** Fixture "today". Everything is generated relative to this, never to the clock. */
const ANCHOR = "2026-09-12T00:00:00.000Z";
const SEED = 20260912;
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
const rng = makeRng(SEED);
const randInt = (min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[randInt(0, items.length - 1)];
/** Jitter a cent amount by +/- pct, rounded to whole dollars. */
const jitter = (cents: number, pct: number) =>
  Math.round((cents * (1 + (rng() * 2 - 1) * pct)) / 100) * 100;

const usd = (amount: number) => ({ amount, currency: "USD" });
const dollars = (n: number) => Math.round(n * 100);

function at(year: number, month: number, day: number, hour = 15): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(day, lastDay), hour, randInt(0, 59), 0),
  ).toISOString();
}
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

let txnSeq = 0;
let mmSeq = 0;
const nextTxnId = () => `txn_${String(++txnSeq).padStart(6, "0")}`;
const nextMmId = () => `mm_${String(++mmSeq).padStart(6, "0")}`;

// ------------------------------------------------------------------ accounts

type AccountType = "checking" | "credit" | "investment" | "savings" | "rewards";

const ACCOUNTS: {
  id: string;
  account_type: AccountType;
  account_name: string;
  account_number_last_4: string;
  routing_number_last_4?: string;
  opening_cents: number;
}[] = [
  {
    id: "acc_checking_main",
    account_type: "checking",
    account_name: "Northstar Labs — Operating",
    account_number_last_4: "4417",
    routing_number_last_4: "0021",
    opening_cents: dollars(184_920),
  },
  {
    id: "acc_savings_reserve",
    account_type: "savings",
    account_name: "Northstar Labs — Reserve",
    account_number_last_4: "8830",
    routing_number_last_4: "0021",
    opening_cents: dollars(50_000),
  },
  {
    id: "acc_treasury_mmf",
    account_type: "investment",
    account_name: "Northstar Labs — Treasury",
    account_number_last_4: "5512",
    opening_cents: 0,
  },
  {
    id: "acc_credit_card",
    account_type: "credit",
    account_name: "Northstar Labs — Corporate Card",
    account_number_last_4: "9074",
    opening_cents: 0,
  },
  {
    id: "acc_rewards",
    account_type: "rewards",
    account_name: "Northstar Labs — Rewards",
    account_number_last_4: "0001",
    opening_cents: 0,
  },
];
const accountName = (id: string) =>
  ACCOUNTS.find((a) => a.id === id)!.account_name;
const accountType = (id: string) =>
  ACCOUNTS.find((a) => a.id === id)!.account_type;

const USERS = [
  { user_id: "usr_founder", first_name: "Dana", last_name: "Whitfield" },
  { user_id: "usr_cofounder", first_name: "Marcus", last_name: "Olegun" },
  { user_id: "usr_ops", first_name: "Priya", last_name: "Raman" },
  { user_id: "usr_eng", first_name: "Sam", last_name: "Okafor" },
];

// ----------------------------------------------------------------- customers

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
  /** Planted signal for the verification layer to catch later. */
  trait?: "related_party" | "unverifiable";
};

const CUSTOMERS: Customer[] = [
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
];

function mrrFor(c: Customer, monthIdx: number): number {
  if (monthIdx < c.start_month || monthIdx > c.end_month) return 0;
  if (c.expands_at !== undefined && monthIdx >= c.expands_at) return c.expands_to!;
  return c.cents;
}

// ------------------------------------------------------------------- vendors

const SAAS_MERCHANTS = [
  ["Amazon Web Services", 0], ["Vercel", 0], ["GitHub", 0], ["Datadog", 0],
  ["Linear", 0], ["Notion Labs", 0], ["Slack Technologies", 0], ["Figma", 0],
  ["OpenAI", 0], ["Anthropic", 0], ["Google Workspace", 0], ["Zoom", 0],
  ["Sentry", 0], ["Segment", 0], ["Rippling", 0], ["Carta", 0],
  ["Delta Air Lines", 0], ["United Airlines", 0], ["Marriott", 0],
  ["Uber", 0], ["Lyft", 0], ["DoorDash", 0], ["Blue Bottle Coffee", 0],
  ["Apple Store", 0], ["Best Buy", 0], ["Staples", 0],
] as const;

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

const txns: Txn[] = [];

function tx(p: {
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
  user?: (typeof USERS)[number];
  card_id?: string;
  card_name?: string;
}): Txn {
  const status = p.status ?? "settled";
  const posted =
    status === "settled"
      ? addDays(p.initiated_at, p.settle_days ?? 0)
      : null;
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

// --------------------------------------------------------------------- cards

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
  billing_address: {
    street: "1100 Congress Ave, Suite 400",
    city: "Austin",
    subdivision: "TX",
    postal_code: "78701",
    country_code: "US",
  },
  shipping_address: null,
  blocked_categories: [] as string[],
  allowed_categories: [] as string[],
  blocked_merchants: [] as string[],
  allowed_merchants: [] as string[],
}));

// ------------------------------------------------------- transaction program

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

for (let i = 0; i < MONTH_COUNT; i++) {
  const { y, m } = monthOf(i);
  const maxDay = lastDayOf(i);
  const isCurrent = i === MONTH_COUNT - 1;

  // --- Customer revenue (invoiced ACH credits) -----------------------------
  for (const c of CUSTOMERS) {
    const cents = mrrFor(c, i);
    if (cents === 0) continue;
    if (c.pay_day > maxDay) continue;

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
      account_id: "acc_checking_main",
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

  // --- Self-serve revenue via aggregated Stripe payouts --------------------
  // Deliberately unattributable to individual customers from bank data alone.
  const weeklyBase = dollars(1_800 + i * 260);
  for (const day of [4, 11, 18, 25]) {
    if (day > maxDay) continue;
    tx({
      account_id: "acc_checking_main",
      type: "ach_credit",
      amount: jitter(weeklyBase, 0.22),
      initiated_at: at(y, m, day, 9),
      counterparty_name: "Stripe Payments",
      memo: "ACH CREDIT STRIPE TRANSFER ST-N4KD9QX",
    });
  }

  // --- Financing: NOT revenue ---------------------------------------------
  if (i === 2) {
    tx({
      account_id: "acc_checking_main",
      type: "wire_in",
      amount: dollars(2_500_000),
      initiated_at: at(y, m, 19, 11),
      counterparty_name: "Harborline Ventures II LP",
      memo: "WIRE IN SEED PREFERRED SERIES SEED CLOSING",
      note: "Seed round close",
    });
  }
  if (i === 11) {
    tx({
      account_id: "acc_checking_main",
      type: "wire_in",
      amount: dollars(750_000),
      initiated_at: at(y, m, 7, 11),
      counterparty_name: "Harborline Ventures II LP",
      memo: "WIRE IN SAFE NOTE BRIDGE",
      note: "Bridge SAFE",
    });
  }

  // --- Payroll -------------------------------------------------------------
  // Headcount grows from ~6 to ~16; each run is half the month's payroll.
  const payrollBase = dollars(38_000 + i * 4_200);
  for (const day of [15, maxDay >= 28 ? 28 : maxDay]) {
    if (day > maxDay) continue;
    tx({
      account_id: "acc_checking_main",
      type: "ach_debit",
      amount: -jitter(payrollBase, 0.04),
      initiated_at: at(y, m, day, 13),
      counterparty_name: "Gusto Payroll",
      memo: "ACH DEBIT GUSTO PAYROLL RUN",
      user: USERS[2],
    });
  }

  // --- Fixed operating costs ----------------------------------------------
  if (maxDay >= 2) {
    tx({
      account_id: "acc_checking_main",
      type: "ach_debit",
      amount: -dollars(12_400),
      initiated_at: at(y, m, 2, 10),
      counterparty_name: "WeWork Congress Ave",
      memo: "ACH DEBIT WEWORK OFFICE LEASE",
    });
  }
  if (maxDay >= 6) {
    tx({
      account_id: "acc_credit_card",
      type: "card_debit",
      amount: -jitter(dollars(8_200 + i * 640), 0.12),
      initiated_at: at(y, m, 6, 8),
      counterparty_name: "Amazon Web Services",
      memo: "AWS EMEA CLOUD SERVICES",
      card_id: CARDS[3].id,
      card_name: CARDS[3].name,
      user: USERS[3],
    });
  }

  // --- Discretionary card spend -------------------------------------------
  const swipes = randInt(9, 15);
  for (let s = 0; s < swipes; s++) {
    const day = randInt(1, maxDay);
    const merchant = pick(SAAS_MERCHANTS)[0];
    const card = pick(CARDS);
    const amount = -dollars(randInt(29, 2_400));
    // Recent swipes are still pending.
    const pending = isCurrent && day >= maxDay - 3;
    tx({
      account_id: "acc_credit_card",
      type: "card_debit",
      amount,
      initiated_at: at(y, m, day, randInt(7, 21)),
      counterparty_name: merchant,
      memo: merchant.toUpperCase(),
      status: pending ? "pending" : "settled",
      settle_days: 2,
      card_id: card.id,
      card_name: card.name,
      user: card.cardholder,
    });
  }

  // --- Contractors abroad, with the fee as its own row --------------------
  if (maxDay >= 20) {
    const mm = nextMmId();
    tx({
      account_id: "acc_checking_main",
      type: "international_wire_out",
      amount: -jitter(dollars(14_500), 0.1),
      initiated_at: at(y, m, 20, 12),
      counterparty_name: "Lindgren Design AB",
      memo: "INTL WIRE OUT DESIGN RETAINER",
      money_movement_id: mm,
      user: USERS[1],
    });
    tx({
      account_id: "acc_checking_main",
      type: "international_wire_fee",
      amount: -dollars(45),
      initiated_at: at(y, m, 20, 12),
      counterparty_name: "Rho Bank",
      memo: "INTL WIRE FEE",
      money_movement_id: mm,
    });
  }

  // --- Related-party outflow, mirroring cus_0013's inbound ----------------
  const quill = CUSTOMERS.find((c) => c.id === "cus_0013")!;
  if (i >= quill.start_month && maxDay >= 24) {
    tx({
      account_id: "acc_checking_main",
      type: "wire_out",
      amount: -dollars(9_000),
      initiated_at: at(y, m, 24, 14),
      counterparty_name: "Quill & Stone LLC",
      memo: "WIRE OUT ADVISORY SERVICES",
      user: USERS[0],
    });
  }

  // --- Corporate card repayment: two legs, one money movement -------------
  if (maxDay >= 10 && i > 0) {
    const owed = txns
      .filter(
        (t) =>
          t.account_id === "acc_credit_card" &&
          t.transaction_type === "card_debit" &&
          t.status === "settled" &&
          Date.parse(t.initiated_at) < Date.UTC(y, m, 1),
      )
      .reduce((sum, t) => sum + t.amount.amount, 0);
    const repaid = txns
      .filter(
        (t) =>
          t.account_id === "acc_credit_card" &&
          t.transaction_type === "credit_repayment",
      )
      .reduce((sum, t) => sum + t.amount.amount, 0);
    const due = -(owed + repaid);
    if (due > 0) {
      const mm = nextMmId();
      tx({
        account_id: "acc_checking_main",
        type: "credit_repayment",
        amount: -due,
        initiated_at: at(y, m, 10, 16),
        counterparty_name: "Rho Corporate Card",
        memo: "CARD AUTOPAY STATEMENT BALANCE",
        money_movement_id: mm,
      });
      tx({
        account_id: "acc_credit_card",
        type: "credit_repayment",
        amount: due,
        initiated_at: at(y, m, 10, 16),
        counterparty_name: "Rho Corporate Card",
        memo: "STATEMENT PAYMENT RECEIVED",
        money_movement_id: mm,
      });
    }
  }

  // --- Treasury sweep: both legs share a money_movement_id ----------------
  if (i >= 3 && i % 3 === 0 && maxDay >= 27) {
    const mm = nextMmId();
    const sweep = dollars(250_000);
    tx({
      account_id: "acc_checking_main",
      type: "internal_transfer",
      amount: -sweep,
      initiated_at: at(y, m, 27, 10),
      counterparty_name: "Northstar Labs — Treasury",
      memo: "INTERNAL TRANSFER TO TREASURY",
      money_movement_id: mm,
      user: USERS[0],
    });
    tx({
      account_id: "acc_treasury_mmf",
      type: "treasury_deposit",
      amount: sweep,
      initiated_at: at(y, m, 27, 10),
      counterparty_name: "Northstar Labs — Operating",
      memo: "TREASURY DEPOSIT",
      money_movement_id: mm,
    });
  }

  // --- Non-revenue inflows ------------------------------------------------
  if (maxDay >= 28) {
    tx({
      account_id: "acc_savings_reserve",
      type: "savings_interest",
      amount: dollars(randInt(120, 310)),
      initiated_at: at(y, m, 28, 6),
      counterparty_name: "Rho Bank",
      memo: "INTEREST PAID",
    });
    const treasuryBal = txns
      .filter((t) => t.account_id === "acc_treasury_mmf")
      .reduce((s, t) => s + t.amount.amount, 0);
    if (treasuryBal > 0) {
      tx({
        account_id: "acc_treasury_mmf",
        type: "treasury_interest",
        amount: Math.round(treasuryBal * 0.0037),
        initiated_at: at(y, m, 28, 6),
        counterparty_name: "Rho Treasury",
        memo: "MONEY MARKET YIELD",
      });
    }
    tx({
      account_id: "acc_rewards",
      type: "rewards_accrual",
      amount: dollars(randInt(180, 640)),
      initiated_at: at(y, m, 28, 6),
      counterparty_name: "Rho Rewards",
      memo: "POINTS ACCRUAL",
    });
  }

  // --- Occasional refunds and reversals -----------------------------------
  if (rng() < 0.3 && maxDay >= 17) {
    tx({
      account_id: "acc_credit_card",
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

// --- One-off edge cases --------------------------------------------------

// A vendor ACH that bounced back — the debit and its return share a movement id.
{
  const mm = nextMmId();
  tx({
    account_id: "acc_checking_main",
    type: "ach_debit",
    amount: -dollars(6_400),
    initiated_at: "2026-02-09T16:12:00.000Z",
    counterparty_name: "Palmer Creative Studio",
    memo: "ACH DEBIT VENDOR INVOICE 2291",
    money_movement_id: mm,
  });
  tx({
    account_id: "acc_checking_main",
    type: "ach_return",
    amount: dollars(6_400),
    initiated_at: "2026-02-12T16:12:00.000Z",
    counterparty_name: "Palmer Creative Studio",
    memo: "ACH RETURN R01 INSUFFICIENT FUNDS",
    money_movement_id: mm,
    note: "Vendor account closed, reissued by wire",
  });
}
// A failed outbound — must never count toward burn.
tx({
  account_id: "acc_checking_main",
  type: "ach_debit",
  amount: -dollars(3_200),
  initiated_at: "2026-05-21T15:03:00.000Z",
  counterparty_name: "Cedar Park Utilities",
  memo: "ACH DEBIT UTILITIES",
  status: "failed",
});
// An outbound wire still awaiting approval as of the anchor date.
tx({
  account_id: "acc_checking_main",
  type: "wire_out",
  amount: -dollars(18_000),
  initiated_at: "2026-09-10T17:41:00.000Z",
  counterparty_name: "Ridgeway Compliance Advisors",
  memo: "WIRE OUT SOC2 AUDIT",
  status: "awaiting_approval",
  user: USERS[1],
});
// A customer refund: revenue that must be netted back out.
tx({
  account_id: "acc_checking_main",
  type: "ach_debit",
  amount: -dollars(4_500),
  initiated_at: "2026-04-18T15:22:00.000Z",
  counterparty_name: "Bellweather Foods Inc.",
  memo: "ACH DEBIT CUSTOMER CREDIT MEMO",
  note: "Partial refund, service credit",
});
// A check deposit from a customer who pays offline.
tx({
  account_id: "acc_checking_main",
  type: "check_deposit",
  amount: dollars(7_500),
  initiated_at: "2026-06-03T14:05:00.000Z",
  counterparty_name: "Larkspur Municipal District",
  memo: "CHECK DEPOSIT 10482",
  settle_days: 3,
});

txns.sort((a, b) => Date.parse(a.initiated_at) - Date.parse(b.initiated_at));

// ------------------------------------------------------------------ invoices

let invSeq = 0;
const invoices = invoiceSeeds
  .sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt))
  .map((seed) => {
    const n = ++invSeq;
    const issued = addDays(seed.paidAt, -randInt(3, 10));
    const unit = Math.round(seed.cents / seed.months);
    return {
      id: `inv_${String(n).padStart(5, "0")}`,
      invoice_number: `NS-${String(1000 + n)}`,
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
              ? "Northstar Platform — Annual Subscription"
              : "Northstar Platform — Monthly Subscription",
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

const customers = CUSTOMERS.map((c) => {
  const mine = invoices.filter((inv) => inv.customer.id === c.id);
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
    note: c.trait === "related_party" ? "Advisory partner — see Dana" : "",
    cc_emails: [] as string[],
    total_revenue: usd(revenue),
    last_invoice_id: last?.id ?? null,
    created_at: first?.created_at ?? ANCHOR,
    updated_at: last?.updated_at ?? ANCHOR,
    deleted_at: null,
  };
});

// ------------------------------------------------------------------ balances
// Balances are derived from the ledger, so cash on hand reconciles with the
// transactions we serve. Pending and failed rows do not move a balance.

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
    ...(a.routing_number_last_4
      ? { routing_number_last_4: a.routing_number_last_4 }
      : {}),
  };
});

// ------------------------------------------------------------------- writing

mkdirSync(OUT_DIR, { recursive: true });
const write = (name: string, data: unknown) =>
  writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2) + "\n");

write("accounts.json", accounts);
write("transactions.json", txns);
write("cards.json", CARDS);
write("customers.json", customers);
write("invoices.json", invoices);
write("meta.json", {
  generator: "scripts/generate-rho-fixtures.ts",
  seed: SEED,
  anchor: ANCHOR,
  company: "Northstar Labs, Inc.",
  period: { first_month: "2025-04", last_month: "2026-09" },
  counts: {
    accounts: accounts.length,
    transactions: txns.length,
    cards: CARDS.length,
    customers: customers.length,
    invoices: invoices.length,
  },
  opening_balances: Object.fromEntries(
    ACCOUNTS.map((a) => [a.id, a.opening_cents]),
  ),
});

const settledCash = accounts
  .filter((a) => a.account_type !== "credit" && a.account_type !== "rewards")
  .reduce((s, a) => s + a.balance.amount, 0);

console.log(
  [
    `accounts      ${accounts.length}`,
    `transactions  ${txns.length}`,
    `cards         ${CARDS.length}`,
    `customers     ${customers.length}`,
    `invoices      ${invoices.length}`,
    `cash on hand  $${(settledCash / 100).toLocaleString("en-US")}`,
  ].join("\n"),
);
