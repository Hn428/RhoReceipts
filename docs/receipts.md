# The demo flow: connect → receipt

Sign in → `/connect` → "Use the sample company" → the receipt at `/r/<slug>`.

## Connect (`/connect`)

The token is checked against Rho **before anything is stored** — a bad token is an
error on the form, never a saved connection that fails later. Rho's 401 and 403
become specific messages (revoked or expired; missing scope). Once accepted the
token is encrypted with the connection id bound in, the ledger is imported, and
the first receipt is issued. Reconnecting the same company updates its row.

"Use the sample company" connects the fixture ledger with the server's mock
token. The browser never sees a token either way.

## The receipt (`/r/<slug>`)

**A snapshot, not a live view.** Issuing runs ledger → classification → metrics
and freezes the result. The page renders only from that snapshot and does no
arithmetic, so the numbers an investor audits can't change after they're shared.
"Issue a fresh receipt" on the dashboard re-syncs and issues a new one.

**Access is the link.** Slugs carry 72 bits of randomness, and the page sets
`noindex, nofollow`. Anyone with the URL can view it; no one can guess it.

**Every line opens to its evidence**, using native `<details>` — no client
JavaScript, keyboard-accessible by default.

| Line | Opens to |
|---|---|
| MRR | Each customer, graded Invoiced / Inferred / Aggregated, then their payments |
| Growth | This month vs last, and twelve months of revenue |
| Net burn | Money out and money in, largest first |
| Cash on hand | Accounts counted, and those that aren't cash |
| Runway | Burn for each of the three complete months behind the average |
| Largest customer | Share of trailing-twelve-month revenue |

Below the figures: **Worth a closer look** (related parties, inferred customers,
aggregated payouts) and **Left out of these figures** (every excluded group,
with why).

### The burn line names what flatters it

August's net burn is $56,360, but June and July were $135,081 and $145,660.
August includes Atlas Freight's $96,000 annual prepayment, which counts in full as
cash. That's correct for cash burn — and misleading as a headline. The line reads
"lowered by $96,000 of prepayments" rather than leaving it to be discovered.

### Snapshot compatibility

Snapshot fields added later are optional, so a link shared before a change keeps
rendering. `prepaymentsInPeriod` is the first; receipts issued before engine
`2026.09.2` simply don't show it. An early version without the guard crashed
older receipts, which is how this was caught.

## Not yet built

- **Customer verification (Tavily).** The customer rows already carry grade chips;
  a "verified company" chip slots in beside them. Needs a `TAVILY_API_KEY`.
- A copy-link button, and a way to revoke a shared receipt.
