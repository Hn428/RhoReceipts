# Phase 1 — Ingestion

Rho API → raw ledger tables in Postgres. Run `npm run dev`, then `npm run sync`.

## Database

No Postgres server required in development. `DATABASE_URL` unset gives you
**PGlite** — real Postgres compiled to WASM, running out of
`~/.cache/rho-receipts/pglite`. Set `DATABASE_URL` and the same Drizzle schema
runs against hosted Postgres with no code change. Identical dialect, identical
migrations. The hosted database is Supabase — see [database.md](database.md).

```bash
npm run db:generate   # regenerate SQL migrations after a schema change
npm run db:reset      # delete the embedded database
npm run sync          # incremental ingest (needs npm run dev)
npm run sync -- --full
```

> **Two hazards worth knowing about.**
>
> The data directory lives at `~/.cache/rho-receipts/pglite`, *outside* the
> project, on purpose. A file-syncing service resolves conflicts by duplicating
> files, and a `base 2` folder beside `base` corrupts the Postgres cluster —
> PGlite then aborts inside WASM with an error that reads like a driver bug.
> If this project sits in an iCloud- or Dropbox-synced folder, that will also
> duplicate source files and Next's generated types. Excluding the folder from
> sync is worth doing.
>
> PGlite is also single-writer. Concurrent page loads and a running sync are
> fine in practice (verified: 12 simultaneous requests plus a full re-sync, all
> clean), but nothing else should open the directory while the app runs. If you
> ever see `RuntimeError: Aborted()`, run `npm run db:reset` — or set
> `DATABASE_URL` to a real Postgres, which needs no code change.

## Schema shape

`rho_*` tables mirror what the API returned; they are the evidence base.
Everything derived in later phases lives in unprefixed tables and must be
rebuildable from these rows alone.

| Table | Role |
|---|---|
| `connections` | One connected Rho credential; every ledger row is scoped to it |
| `rho_accounts` | Latest balance per account |
| `account_balance_snapshots` | Balance over time — runway needs historical cash, and the API only reports "now" |
| `rho_transactions` | Current state of every transaction |
| `rho_transaction_versions` | Append-only history of every observed change |
| `rho_customers` / `rho_invoices` / `rho_invoice_payments` | The invoicing join |
| `sync_runs` | One row per attempt, with stats and errors |

Three decisions worth remembering:

- **Enum-ish columns are `text`.** Rho can add a transaction type without it being
  a breaking change on their side; a Postgres enum turns that into a failed ingest.
- **Money is `bigint` minor units.** No numeric, no float.
- **Natural key is (connection, rho id, account id).** The API documents that `id`
  is "stable across re-fetches, not guaranteed unique per row", so the account is
  in the key to stay correct if one id ever spans two entries.

## Sync guarantees

**Idempotent.** Re-running over the same data changes nothing:

```
run 1 (cold)          inserted 674   updated 0   unchanged 0
run 2 (incremental)   inserted 0     updated 0   unchanged 76
```

**Non-destructive.** Transactions mutate in the real world — pending settles,
`posted_at` fills in. That never overwrites history; it updates the current row
*and* appends a version. Verified by rewinding two rows to a pending observation
and re-syncing:

```
txn_000648  v1 pending  posted_at null   →  v2 settled  posted_at set
txn_000649  v1 pending  posted_at null   →  v2 settled  posted_at set
674 transactions, 676 versions
```

So "this metric changed because that payment settled on the 11th" is answerable
from the database, which is the whole point of the product.

**Incremental, with an overlap window.** Syncing only rows newer than the
watermark would miss pending transactions that settle later — a pending row keeps
its original `initiated_at`, so it never re-appears in a naive "newer than"
window. Sync rewinds `OVERLAP_DAYS` (45) and re-reads. Re-reading is free
*because* the sync is idempotent; the two properties pay for each other. 45 days
outlasts the slowest thing that can still change: an ACH return window, a wire in
`awaiting_approval`, a late card settlement.

## Entry points

`POST /api/sync` is the production path (cron calls it). `scripts/sync.ts` is a
thin HTTP client over that same route rather than a direct import — dev and prod
cannot drift, and it sidesteps module resolution, since path aliases are the
bundler's job and not bare Node's.

## Not done yet

- Tokens. `connections.tokenRef` names an environment variable; `tokenCiphertext`
  is the column Phase 0's envelope encryption will fill. **No token is ever written
  to the database in plaintext**, but real encryption is still outstanding.
- Auth and multi-tenancy. A connection has no owner yet.
- Retries and rate-limit backoff on the Rho client.
