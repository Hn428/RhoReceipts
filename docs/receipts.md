# The demo flow: enroll → receipt

Sign in → `/enroll` → "Use a sample company" → review → **Generate Rho Receipt** →
the receipt at `/r/<slug>`. The old `/connect` route redirects to `/enroll`.

## Enroll (`/enroll`)

The token is checked against Rho **before anything is stored** — a bad token is an
error on the form, never a saved connection that fails later. Rho's 401 and 403
become specific messages (revoked or expired; missing scope). Once accepted the
token is encrypted with the connection id bound in and the ledger is imported.

Import stops short of generating anything. `/enroll/<connectionId>` shows what was
found — accounts, transactions analysed, customers identified — and the founder
chooses to generate the first receipt. A founder account owns one company; a
second connection is rejected.

"Use a sample company" connects a fixture ledger with the server's mock token.
The browser never sees a token either way.

## The receipt (`/r/<slug>`)

**A snapshot, not a live view.** Issuing runs ledger → classification → metrics,
researches the paying customers, and freezes the result. The page renders only from that
snapshot and does no arithmetic, so the numbers an investor audits can't change
after they're shared. "Generate new receipt" on the dashboard re-syncs and issues
a new one.

**Access is the link.** Slugs carry 72 bits of randomness, and the page sets
`noindex, nofollow`. Anyone with the URL can view it; no one can guess it.

**Copy link.** The owner's share panel shows the receipt's full link with a
**Copy link** button. The link is built from the request's host, so it matches the
address the founder is using (`127.0.0.1` under `npm run demo`). If the clipboard
API is unavailable, the link is selected instead so it can be copied by hand. A
copied link opens the receipt but doesn't add it to anyone's portfolio; only
**Share** does that.

### Sharing with an investor

The founder who owns a receipt sees **Share this receipt** on its page. Entering
an email:

- records a `receipt_shares` row for that exact receipt and the normalized
  (trimmed, lowercased) email,
- sends the receipt link through the configured mail transport, and
- adds the receipt to that investor's portfolio (`/investor`) under
  "Receipts shared with you" once the email is sent.

Sharing the same receipt with the same email again sends nothing
("already shared"). A failed send is recorded and can be retried from the same
form, and so can a send left marked "sending" for over five minutes — the sign
of a crash mid-send. A direct share is one-time: it doesn't enroll the email in monthly
updates, which stay opt-in and appear separately in the portfolio.

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

- A way to revoke a shared receipt. Revoking a direct share would remove it from
  the investor's portfolio, but anyone holding the link could still open it.
