# The Rho API surface we build against

Source of truth: <https://docs.rho.co/api/v1/openapi>. The live API is unstable for
our purposes, so we develop against an in-repo mock that implements the published
contract faithfully. Swapping to production is two environment variables.

## Contract conventions (mirrored exactly)

| Concern | Contract |
|---|---|
| Auth | `Authorization: Bearer rhobat_...` |
| Scopes | `accounts:read`, `transactions:read`, `statements:read` — read-only throughout |
| Money | `{ amount: <signed integer, minor units>, currency: <ISO 4217> }` |
| Sign | Positive = into the account, negative = out |
| Time | ISO-8601; `initiated_at` always present, `posted_at` null while pending |
| Paging | `page_size` (max 100) + opaque `page_token` → `page.next_page_token`, null on last page |
| Cursors | Bound to endpoint + filters + sort; reuse under different filters is a 400 |
| Errors | RFC 7807 `application/problem+json` with `type`, `title`, `status`, `detail` |
| Case | snake_case on the wire |

Real tokens expire after 45 days idle, cap at 20 per business, are shown once, and
revoke instantly. Design the connection flow for re-auth, not for a permanent token.

## Endpoints we consume

| Endpoint | Why we need it |
|---|---|
| `GET /accounts` | Cash on hand per account; the denominator of runway |
| `GET /accounts/{id}` | Account detail |
| `GET /transactions` | The ledger — every metric derives from this |
| `GET /transactions/{id}` | Drill-down detail |
| `GET /invoicing/customers` | Customer identity, `total_revenue`, contact domain |
| `GET /invoicing/invoices` | **The join**: `payments[].transaction_id` → exact attribution |
| `GET /cards` | Card-level spend attribution for the burn breakdown |

Deferred: `GET /statements` (period opening/closing balances — useful later for
reconciliation, derivable from the ledger for now) and invoice/transaction file
downloads.

## The invoicing join changes the design

`invoice.payments[].transaction_id` pairs a bank transaction with `invoice.customer.id`.
Where an invoice exists, customer attribution is **exact** — no descriptor parsing, no
LLM-proposed grouping, no fuzzy matching. That's a materially stronger claim to put in
front of an investor than "we guessed from the memo line".

In the fixture, 152 of 240 checking inflows carry that join. The remaining 88 are where
the real work lives:

| Unattributed inflow | Amount | What it teaches |
|---|---|---|
| Stripe Payments (70) | $271,119 | Aggregated payout — per-customer split is impossible from bank data; say so, don't invent it |
| Cobalt Holdings Group (14) | $140,000 | Round, same-day, uninvoiced — the shape of a fabricated customer |
| Harborline Ventures II LP (2) | $3,250,000 | Financing. Revenue-shaped, and 13× all real revenue. Misclassify this and every metric is a lie |
| Larkspur Municipal District | $7,500 | Offline check payer — real revenue with no invoice |
| Palmer Creative Studio | $6,400 | An ACH *return*, not income |

**Design rule:** invoiced revenue is asserted; uninvoiced inflow is classified, and the
page shows which is which. Never present a heuristic result with the same confidence as
a joined one.

## The mock

- **Routes:** `src/app/api/mock/rho/v1/*` — real HTTP handlers, so the client is
  exercised end to end rather than stubbed out.
- **Fidelity:** enforces bearer auth, token validity, `page_size` bounds, cursor/filter
  binding, and problem+json errors. Bugs in our paging surface here, not in production.
- **Client:** `src/lib/rho/client.ts` — the only module that talks to Rho. `server-only`,
  `cache: "no-store"`, and `all*()` async generators that page correctly by construction.
- **Types:** `src/lib/rho/types.ts` — a faithful mirror of the wire contract. These are
  transport shapes, not domain models; ingestion maps them into our own tables.

Point at production by changing `RHO_API_BASE_URL` and `RHO_API_TOKEN`. No code changes.

## The fixture dataset

`scripts/generate-rho-fixtures.ts` → `src/lib/rho/fixtures/*.json` (committed).

Northstar Labs, Inc. — seed-stage B2B SaaS, 18 months (Apr 2025 – Sep 2026),
674 transactions, 5 accounts, 15 customers, 152 invoices.

Deterministic by construction: fixed seed, fixed `ANCHOR` of `2026-09-12`, no
`Date.now()` anywhere. **Compute metrics relative to `meta.anchor`, never the wall
clock**, or golden tests rot the moment the date changes. Regenerate with `npm run fixtures`.

Headline figures, all reconciling against the ledger:

- Cash on hand **$1,771,070** (account balances = opening balance + settled rows)
- Revenue **$42k → $136k**/month
- Trailing-3-month net burn **$71,604** → roughly **24 months** of runway
- Raised $3.25M across a seed round and a bridge

### Deliberately planted traps

Every one of these breaks a naive implementation:

- **Internal transfers** — quarterly $250k sweeps, both legs sharing a `money_movement_id`.
  Count them and you inflate revenue and burn simultaneously.
- **Financing as inflow** — $2.5M seed, $750k bridge.
- **Annual prepayment** — Atlas Freight pays $96,000 once a year. Unamortized, it spikes
  two months and distorts growth rate in four.
- **Churn and expansion** — Ferry Logistics leaves at month 9; Corvus and Meridian expand.
- **Concentration** — Corvus reaches ~25–30% of invoiced revenue.
- **Related party** — Quill & Stone pays us $127,500 while we wire them $126,000.
- **Unverifiable customer** — Cobalt Holdings: round amounts, first of the month, no invoice.
- **Aggregated payouts** — 70 weekly Stripe transfers, unattributable by design.
- **Card repayments** — two legs across checking and the credit account; only one is cash leaving.
- **Refunds and reversals** — `ach_return`, `card_refund`, and a customer credit memo that
  must net back out of revenue.
- **Non-settled rows** — 9 pending, 1 failed, 1 awaiting approval. None may move a balance.
- **Non-revenue inflows** — savings interest, treasury yield, rewards accrual.
