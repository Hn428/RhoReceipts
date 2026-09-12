# Rho Receipts — Build Roadmap

## The one-sentence spec
Derive MRR, net burn, runway, growth, and customer concentration from real Rho bank
transactions, such that every number unfolds into the exact transactions that produced it.

## Architectural invariants
These are non-negotiable; they're what makes the product mean anything.

1. **Arithmetic is deterministic code. Always.** The LLM has exactly two jobs: parsing a
   natural-language claim into a structured claim, and phrasing a verdict that was already
   decided by code. It never sees a number it is asked to compute, compare, or round.
   Enforce with a module boundary: only `lib/llm/*` may import the Anthropic SDK.
2. **Money is integer minor units** (`bigint` cents). No floats, anywhere, ever. One
   `Money` type with explicit currency. Division only at the presentation edge.
3. **Raw transactions are immutable.** Ingest writes append-only rows keyed by Rho's id.
   Every derived thing (classification, grouping, metrics) lives in separate tables that
   can be recomputed from scratch. If we can't rebuild every metric from raw rows, the
   traceability claim is a lie.
4. **Every metric carries its inputs.** A computed metric persists the transaction ids that
   fed it, plus the engine version and the period boundaries used. That's the drill-down,
   and it's also the regression test.
5. **Periods are explicit.** Store UTC instants; define reporting months in one declared
   timezone with half-open boundaries `[start, end)`. Off-by-one-day boundary bugs are the
   classic way financial dashboards silently disagree with reality.
6. **The Rho token is the crown jewel.** Encrypted at rest, decrypted only in server-side
   sync code, never in a client bundle, never in a log line, never in an error message.

## Unknowns to resolve before Phase 1
- Rho API: how a read-only access token is issued to a third party; transaction fields
  available (counterparty name? memo? category? ACH vs card?); pagination and cursoring;
  whether a sandbox or test dataset exists; webhooks vs polling.
- Whether Rho exposes a stable counterparty identity, or only free-text descriptors
  (assume the latter — it changes how much work Phase 2 is).

## Phases

### Phase 0 — Foundations — **DONE**
- Postgres + Drizzle, migrations, `.env` schema validation.
- Auth (Auth.js v5, email magic link) — founder accounts only for now.
- `Money` type + `lib/money.ts`; period helpers in `lib/period.ts`.
- Envelope encryption helper for stored credentials.
- Vitest wired up.
**Done:** money, period, encryption, validated env, Auth.js magic-link sign-in,
and a dashboard shell behind it. 67 tests. See `docs/foundations.md`.

### Phase 1 — Ingestion (behind an adapter) — **DONE**
- `LedgerSource` interface with two implementations: `FixtureSource` (seeded, realistic,
  checked into the repo) and `RhoSource` (live).
- Schema: `connections`, `accounts`, `transactions` (append-only, idempotent upsert on
  Rho id), `sync_runs` with cursor + error state.
- Incremental sync route + cron.
**Done:** 674 transactions, 5 accounts, 15 customers, 152 invoices ingested
idempotently, with append-only version history. See `docs/ingestion.md`. The
transaction *table UI* is still outstanding and rolls into Phase 4.

### Phase 2 — Classification — **DONE** (see `docs/metrics.md`)
This is where correctness is won or lost. Budget real time here.
- **Internal transfer netting.** Money moving between two connected Rho accounts is not
  revenue and not burn. Match by amount + date proximity + both-sides-connected. Getting
  this wrong inflates both MRR and burn.
- **Inflow taxonomy:** customer revenue / investment / loan / interest / refund / transfer.
  Investment rounds landing as a single large inbound must never count as revenue.
- **Use the invoice join first.** `rho_invoice_payments.rho_transaction_id` gives
  exact customer attribution for 152 of 240 checking inflows. Classify only what
  is left, and never present a heuristic result as confidently as a joined one.
- **Counterparty normalization.** Bank descriptors are sludge (`STRIPE TRANSFER ACME`,
  `ACME INC ACH DEP`). Deterministic normalization first; LLM may *propose* groupings, which
  are persisted as reviewed mappings and only then used by math.
- Founder review UI to confirm/override — overrides are data, and they're auditable.
**Done when:** every transaction has a class and a counterparty, with an override trail.

### Phase 3 — Metric engine — **DONE** (see `docs/metrics.md`)
Pure functions, no I/O, golden-fixture tests.
- **MRR** — recurring inbound per customer, normalized to monthly; annual prepayments
  amortized. State the method on the page: this is a *modeled* figure from cash, not an
  invoicing system's MRR. Honesty here is the moat.
- **Net burn** — operating outflows minus operating inflows, financing excluded.
- **Runway** — cash on hand / trailing-3-month average net burn.
- **Growth rate** — MoM on classified revenue, compounding.
- **Concentration** — top-N customer share + HHI.
Each returns `{ value, inputTransactionIds, method, period, engineVersion }`.
**Done when:** metrics are reproducible and every test asserts against a fixture ledger.

### Phase 4 — The metrics page + drill-down — **DONE** (see `docs/receipts.md`)
The demo. Click a metric, it unfolds into the transactions behind it, grouped by customer
and month, each row traceable to a bank record.
**Done when:** an investor could audit a number in under ten seconds.

### Phase 5 — Customer verification (Tavily)
- Per-counterparty: web presence, domain age, registration footprint. Cache results with
  the evidence snapshot so a verdict is reproducible, not re-rolled on each view.
- **Related-party flags in deterministic code**, not the LLM: circular flows (inbound from
  an entity we also pay), round-number-same-day patterns, shared domain with the founder's
  own company, counterparty with no confirmable existence.
**Done when:** each paying customer shows verified / unconfirmed / flagged, with evidence.

### Phase 6 — Shareable page — **DONE**, minus revocation (see `docs/receipts.md`)
- Public slug, redaction modes (real names vs "Customer A"), optional expiry, view log.
- "Verified by Rho Receipts" with the methodology disclosed, not buried.
**Done when:** a founder can send a link that leaks nothing they didn't choose to show.

### Phase 7 — Claim Checker
- LLM parses a pitch-deck sentence into structured claims.
- Code evaluates each claim against computed metrics → supported / contradicted /
  unverifiable, with tolerance bands and the evidence set.
- LLM phrases the verdict it was handed.
**Done when:** "We're at $40k MRR growing 20% MoM" returns a graded, drillable answer.

### Phase 8 — Hardening
Rate limits, audit log, error states for stale/failed syncs, a polished demo dataset,
and an explicit "what this does and doesn't prove" page.

## Risk register
- **MRR from bank cash is approximate.** Refunds, annual deals, usage billing, and Stripe
  payout netting all distort it. Mitigation: disclose method, show the transactions, never
  overclaim precision.
- **Payment processor aggregation.** If revenue arrives as one daily Stripe payout, per-customer
  attribution is impossible from bank data alone. Detect this case and say so honestly
  rather than inventing a breakdown.
- **Internal transfers** — see Phase 2. The single most likely source of embarrassing numbers.
- **Token custody** — a read-only token is still full financial history. Treat a leak as fatal.
