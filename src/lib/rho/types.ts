/**
 * Wire types for the Rho API v1, mirroring https://docs.rho.co/api/v1/openapi.
 *
 * These are the *transport* shapes: snake_case, money in signed minor units,
 * timestamps as ISO-8601 strings. Nothing in here is a domain model — the
 * ingestion layer maps these into our own tables. Keep them a faithful mirror
 * of the published contract so the mock and the real API stay interchangeable.
 */

/** ISO 4217 code, e.g. "USD". */
export type CurrencyCode = string;

/**
 * Amounts are *signed* integers in minor units (cents for USD).
 * Positive = money into the account, negative = money out.
 */
export interface RhoMoney {
  amount: number;
  currency: CurrencyCode;
}

export const RHO_ACCOUNT_TYPES = [
  "checking",
  "credit",
  "investment",
  "savings",
  "rewards",
] as const;
export type RhoAccountType = (typeof RHO_ACCOUNT_TYPES)[number];

export interface RhoAccount {
  id: string;
  account_type: RhoAccountType;
  balance: RhoMoney;
  account_name?: string;
  account_number_last_4?: string;
  routing_number_last_4?: string;
}

export const RHO_TRANSACTION_TYPES = [
  "card_credit",
  "card_debit",
  "card_refund",
  "credit_repayment",
  "credit_repayment_refund",
  "credit_cashback",
  "ach_credit",
  "ach_debit",
  "ach_return",
  "wire_in",
  "wire_out",
  "wire_fee",
  "international_wire_in",
  "international_wire_out",
  "international_wire_fee",
  "international_wire_fee_refund",
  "check_deposit",
  "check_payment",
  "internal_transfer",
  "savings_deposit",
  "savings_withdrawal",
  "savings_interest",
  "treasury_deposit",
  "treasury_withdrawal",
  "treasury_fee",
  "treasury_interest",
  "treasury_maturity",
  "treasury_sale",
  "treasury_market_value_adjustment",
  "rewards_accrual",
  "rewards_cashback_redemption",
  "adjustment_credit",
  "adjustment_debit",
] as const;
export type RhoTransactionType = (typeof RHO_TRANSACTION_TYPES)[number];

export const RHO_TRANSACTION_STATUSES = [
  "pending",
  "settled",
  "failed",
  "awaiting_approval",
] as const;
export type RhoTransactionStatus = (typeof RHO_TRANSACTION_STATUSES)[number];

export interface RhoAttachment {
  file_id: string;
  file_name: string;
}

export interface RhoTransaction {
  /** Stable across re-fetches. NOT guaranteed unique per row — see money_movement_id. */
  id: string;
  /** Shared by every leg of the same money movement (e.g. both sides of a transfer). */
  money_movement_id: string;
  account_id: string;
  account_type: RhoAccountType;
  account_name: string;
  transaction_type: RhoTransactionType;
  status: RhoTransactionStatus;
  amount: RhoMoney;
  /** Always present. */
  initiated_at: string;
  /** Null while pending. */
  posted_at: string | null;
  counterparty_name: string;
  counterparty_logo_url: string | null;
  /** Bank-supplied descriptor, read-only. */
  memo: string | null;
  /** User-editable annotation. */
  note: string | null;
  user_id: string | null;
  user_full_name: string | null;
  card_id: string | null;
  card_name: string | null;
  tracking_number: string | null;
  attachments: RhoAttachment[];
}

export type RhoCardType = "physical" | "virtual";
export type RhoCardStatus = "active" | "frozen" | "cancelled" | "pending";
export type RhoSpendingLimitType =
  | "fixed"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "single_use";

export interface RhoAddress {
  street: string;
  city: string;
  subdivision: string;
  postal_code: string;
  country_code: string;
}

export interface RhoCard {
  id: string;
  name: string;
  last_4: string;
  type: RhoCardType;
  status: RhoCardStatus;
  cardholder: { user_id: string; first_name: string; last_name: string };
  spending_limit: RhoMoney | null;
  spending_limit_type: RhoSpendingLimitType | null;
  current_spend: RhoMoney | null;
  pending_spend: RhoMoney | null;
  spend_period_start: string | null;
  spend_period_end: string | null;
  usage_starts_at: string | null;
  usage_ends_at: string | null;
  billing_address: RhoAddress;
  shipping_address: RhoAddress | null;
  blocked_categories: string[];
  allowed_categories: string[];
  blocked_merchants: string[];
  allowed_merchants: string[];
}

export interface RhoCustomerAddress {
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
}

export interface RhoInvoicingCustomer {
  id: string;
  legal_name: string;
  email: string;
  address: RhoCustomerAddress;
  note: string;
  cc_emails: string[];
  total_revenue: RhoMoney;
  last_invoice_id: string | null;
  created_at: string;
  updated_at: string;
  /** Null if active. */
  deleted_at: string | null;
}

export type RhoInvoiceStatus =
  | "paid"
  | "unpaid"
  | "cancelled"
  | "overdue"
  | "confirm_payment"
  | "pending_payout";

export type RhoInvoicePaymentType = "received_in_account" | "external";

export interface RhoInvoiceLineItem {
  name: string;
  unit_price: RhoMoney;
  quantity: number;
  discount_rate: number | null;
  tax_rate: number | null;
  total: RhoMoney;
}

export interface RhoInvoicePayment {
  type: RhoInvoicePaymentType;
  external_method: string | null;
  paid_at: string;
  /**
   * The bank transaction that settled this invoice. This is the join that gives
   * us exact customer attribution instead of descriptor guesswork.
   */
  transaction_id: string | null;
}

export interface RhoInvoiceActivity {
  activity_type: string;
  created_at: string;
  user_id: string | null;
  emails: string[];
}

export interface RhoInvoice {
  id: string;
  invoice_number: string;
  status: RhoInvoiceStatus;
  date: string;
  due_date: string | null;
  note: string;
  customer: { id: string };
  total: RhoMoney;
  tax_rate: number;
  discount_rate: number;
  line_items: RhoInvoiceLineItem[];
  payments: RhoInvoicePayment[];
  activities: RhoInvoiceActivity[];
  file_id: string | null;
  accounting_sync_status:
    | "not_pushed"
    | "synced"
    | "error"
    | "skip"
    | "object_changed";
  accounting_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Every list response carries this envelope. Null token = last page. */
export interface RhoPage {
  next_page_token: string | null;
}

export interface RhoListAccountsResponse {
  accounts: RhoAccount[];
  page: RhoPage;
}
export interface RhoListTransactionsResponse {
  transactions: RhoTransaction[];
  page: RhoPage;
}
export interface RhoListCardsResponse {
  cards: RhoCard[];
  page: RhoPage;
}
export interface RhoListCustomersResponse {
  customers: RhoInvoicingCustomer[];
  page: RhoPage;
}
export interface RhoListInvoicesResponse {
  invoices: RhoInvoice[];
  page: RhoPage;
}

/** RFC 7807 problem+json, the shape of every Rho error. */
export interface RhoProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
}
