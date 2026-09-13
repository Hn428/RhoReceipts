/**
 * Rho API v1 client.
 *
 * This is the *only* place the app talks to Rho. It points at the mock by
 * default and at api.rho.co in production — same code path either way, so the
 * swap is a base URL and a token, not a rewrite.
 *
 * Server-side only: the access token must never reach a client bundle.
 */

import "server-only";

import type {
  RhoAccount,
  RhoCard,
  RhoInvoice,
  RhoInvoicingCustomer,
  RhoListAccountsResponse,
  RhoListCardsResponse,
  RhoListCustomersResponse,
  RhoListInvoicesResponse,
  RhoListTransactionsResponse,
  RhoProblem,
  RhoTransaction,
  RhoTransactionStatus,
  RhoTransactionType,
} from "./types";

export class RhoApiError extends Error {
  readonly status: number;
  readonly problem: RhoProblem | null;

  constructor(status: number, problem: RhoProblem | null, fallback: string) {
    super(problem?.detail ?? problem?.title ?? fallback);
    this.name = "RhoApiError";
    this.status = status;
    this.problem = problem;
  }
}

export interface RhoClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

/** Values accepted in a query: repeated for arrays, dropped when nullish. */
type QueryValue = string | number | boolean | string[] | null | undefined;
export type RhoQuery = Record<string, QueryValue>;

export interface ListTransactionsParams extends RhoQuery {
  account_id?: string[];
  transaction_type?: RhoTransactionType[];
  status?: RhoTransactionStatus[];
  search?: string;
  initiated_after?: string;
  initiated_before?: string;
  posted_after?: string;
  posted_before?: string;
  min_amount?: number;
  max_amount?: number;
  sort_by?: string;
  order?: "asc" | "desc";
  page_size?: number;
  page_token?: string;
}

export class RhoClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RhoClientOptions = {}) {
    const baseUrl =
      options.baseUrl ??
      process.env.RHO_API_BASE_URL ??
      "http://localhost:3000/api/mock/rho/v1";
    const token = options.token ?? process.env.RHO_API_TOKEN;
    if (!token) {
      throw new Error(
        "RHO_API_TOKEN is not set. Copy .env.example to .env.local to use the mock API.",
      );
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private buildUrl(path: string, query: RhoQuery = {}): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else {
        params.append(key, String(value));
      }
    }
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  private async request<T>(path: string, query: RhoQuery = {}): Promise<T> {
    const res = await this.fetchImpl(this.buildUrl(path, query), {
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
      },
      // Financial data is never served from a stale cache.
      cache: "no-store",
    });

    if (!res.ok) {
      let parsed: RhoProblem | null = null;
      try {
        parsed = (await res.json()) as RhoProblem;
      } catch {
        // Non-JSON error body; fall through with a null problem.
      }
      throw new RhoApiError(res.status, parsed, `Rho API ${res.status} on ${path}`);
    }
    return (await res.json()) as T;
  }

  listAccounts(query: RhoQuery = {}) {
    return this.request<RhoListAccountsResponse>("/accounts", query);
  }
  getAccount(accountId: string) {
    return this.request<RhoAccount>(`/accounts/${encodeURIComponent(accountId)}`);
  }
  listTransactions(query: ListTransactionsParams = {}) {
    return this.request<RhoListTransactionsResponse>("/transactions", query);
  }
  getTransaction(id: string) {
    return this.request<RhoTransaction>(`/transactions/${encodeURIComponent(id)}`);
  }
  listCards(query: RhoQuery = {}) {
    return this.request<RhoListCardsResponse>("/cards", query);
  }
  listInvoicingCustomers(query: RhoQuery = {}) {
    return this.request<RhoListCustomersResponse>("/invoicing/customers", query);
  }
  listInvoicingInvoices(query: RhoQuery = {}) {
    return this.request<RhoListInvoicesResponse>("/invoicing/invoices", query);
  }

  /**
   * Walks every page of a list endpoint.
   *
   * Cursors are bound to their filter set, so the query is held fixed across
   * the walk and only page_token advances. Sync code should prefer this over
   * hand-rolled paging.
   */
  private async *paginateAll<TItem, TResponse extends { page: { next_page_token: string | null } }>(
    fetchPage: (query: RhoQuery) => Promise<TResponse>,
    extract: (response: TResponse) => TItem[],
    query: RhoQuery,
  ): AsyncGenerator<TItem, void, undefined> {
    let pageToken: string | undefined;
    do {
      const response = await fetchPage({ ...query, page_token: pageToken });
      for (const item of extract(response)) yield item;
      pageToken = response.page.next_page_token ?? undefined;
    } while (pageToken);
  }

  allTransactions(query: ListTransactionsParams = {}) {
    return this.paginateAll<RhoTransaction, RhoListTransactionsResponse>(
      (q) => this.listTransactions(q as ListTransactionsParams),
      (r) => r.transactions,
      { page_size: 100, ...query },
    );
  }
  allAccounts(query: RhoQuery = {}) {
    return this.paginateAll<RhoAccount, RhoListAccountsResponse>(
      (q) => this.listAccounts(q),
      (r) => r.accounts,
      { page_size: 100, ...query },
    );
  }
  allInvoicingCustomers(query: RhoQuery = {}) {
    return this.paginateAll<RhoInvoicingCustomer, RhoListCustomersResponse>(
      (q) => this.listInvoicingCustomers(q),
      (r) => r.customers,
      { page_size: 100, ...query },
    );
  }
  allInvoicingInvoices(query: RhoQuery = {}) {
    return this.paginateAll<RhoInvoice, RhoListInvoicesResponse>(
      (q) => this.listInvoicingInvoices(q),
      (r) => r.invoices,
      { page_size: 100, ...query },
    );
  }
  allCards(query: RhoQuery = {}) {
    return this.paginateAll<RhoCard, RhoListCardsResponse>(
      (q) => this.listCards(q),
      (r) => r.cards,
      { page_size: 100, ...query },
    );
  }
}

/** Convenience for server code that just wants the configured client. */
export function rho(): RhoClient {
  return new RhoClient();
}
