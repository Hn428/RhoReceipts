# Phase 0 — Foundations

Five modules the rest of the system is built on, plus authentication.

| Module | Purpose |
|---|---|
| `src/lib/money.ts` | Integer-minor-unit money with currency-safe arithmetic |
| `src/lib/period.ts` | Half-open month boundaries in a declared timezone |
| `src/lib/crypto/envelope.ts` | AES-256-GCM envelope encryption for stored tokens |
| `src/lib/env.ts` | Environment validated once, at boot |
| `src/auth.ts` | Passwordless email sign-in (Auth.js v5) |

`npm test` — 67 tests across money, period and encryption.

## Money

No float path exists. If a value is money it carries its currency, so adding
dollars to pounds throws instead of silently corrupting a metric.

Division is split three ways on purpose, because the three uses have different
correctness requirements:

- **`allocate`** splits into parts that sum back *exactly*. Amortising a $96,000
  annual prepayment across twelve months must not lose a cent — that discrepancy
  is one a founder would have to explain to an investor. Uses largest-remainder.
- **`scale`** multiplies by a factor with an explicit rounding mode. Defaults to
  banker's rounding: rounding half away from zero drifts upward across many
  values, which is exactly how a "verified" number ends up a few dollars wrong
  and impossible to account for.
- **`ratio`** leaves money space and returns a plain number. A growth rate is not
  money, and typing it as money invites adding a percentage to a balance.

## Period

A month is not a fixed span of hours — it depends on a timezone and moves with
daylight saving. Two components that disagree by one day on where September
starts disagree on MRR forever.

- Periods are **half-open**, `[start, end)`. A transaction posted at exactly
  midnight on 1 October belongs to October, never to both months or neither.
- Boundaries come from one declared reporting zone (`REPORTING_TIME_ZONE`), not
  the server's local zone.
- **Nothing reads the clock.** Callers pass `asOf`; against fixtures that is the
  dataset anchor, so results never drift.
- `completeTrailingMonths` excludes a month still in progress. Including a
  twelve-day-old September in a trailing-three-month burn average understates
  burn by roughly a third and overstates runway by the same margin.

Node 26 has no `Temporal`, so zone maths is hand-rolled on `Intl` with a
two-pass offset resolution — a single pass lands an hour out near DST
transitions. Tested against both US transitions and a zone ahead of UTC.

## Encryption

Envelope rather than direct encryption: rotating the master key only re-wraps
short data keys instead of re-encrypting every secret, and the wrap step is the
seam where a real KMS drops in without touching call sites.

Each secret gets a single-use 256-bit data key, that key wrapped by the master
key, and an **AAD binding the ciphertext to its context** — `connection:<id>`.
A ciphertext lifted from one row will not decrypt in another.

This is wired into the live path: `ensureDevConnection` encrypts the token into
`connections.tokenCiphertext`, and sync decrypts it on every run. The gap flagged
at the end of Phase 1 is closed.

```
ENCRYPTION_KEY — 32 bytes, base64. Generate with:
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Authentication

Auth.js v5 with passwordless email. No passwords are stored, which removes a
whole class of breach from a product whose premise is that a founder trusts it
with bank data.

The sign-in link is **printed to the terminal** rather than emailed, so auth works
with no mail credentials and nothing leaves the machine. Receipt shares and monthly
updates print the same way (`src/lib/mail`). This is deliberate while the app runs
locally. A hosted deployment would need a real transport first, since no one could
sign in: `consoleEmailProvider` in `src/auth.ts` and `sendMail` are the two places
to swap.

Verified end to end: CSRF → magic link → callback → database session →
`/dashboard` renders for the signed-in founder, and redirects to `/signin` when
not.

## One configuration note

`next.config.ts` marks `@electric-sql/pglite` and `postgres` as
`serverExternalPackages`. Both touch the filesystem directly, and bundling them
rewrites the module graph enough to break Node's `fs` path handling — it
surfaces as `CREATE SCHEMA` failing with a `path`/`URL` type error.

## Multi-tenancy

Multi-tenancy is closed: `connections.ownerId` scopes every ledger row to a
founder, since all ledger tables hang off a connection. Verified with two signed-in
users — the second sees none of the first's connections, and requesting the first's
connection by id returns 404 rather than 403, so it does not confirm the id exists.

## Still outstanding

- Rho client retry and rate-limit backoff (see [ingestion.md](ingestion.md)).
