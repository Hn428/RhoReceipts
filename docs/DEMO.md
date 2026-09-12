# Demo walkthrough

Run `npm install`, then `npm run demo`. No API keys or running server are needed.
Open [Rho Receipts](http://127.0.0.1:3000/).
Use `DEMO_PORT=3100 npm run demo` if port 3000 is occupied.

The command creates `.demo/pglite`, generates persistent demo-only encryption and
sign-in secrets, imports one mock ledger for each demo founder through the real sync
pipeline, creates their August 2026 reports, and starts Next. It never resets
your normal database. All financial data, companies, and customer research in this
demo are simulated. Mail is printed to the terminal; nothing is emailed.

Stop the demo server before rerunning setup: embedded PGlite permits only one
process per database directory. Re-running setup refreshes the simulated ledgers
and reuses existing monthly reports and deliveries. It does
not delete receipts you generated while exploring. `npm run demo -- --seed-only`
prepares the same data without starting a server. Links are saved in
`.demo/manifest.json`.

## Five-minute script

1. **Show where the records came from.** Open `/mock-rho`, select Acme AI, and inspect
   the simulated banking environment. `/enroll` walks a founder through import,
   review and generating a new receipt. Enrollment is voluntary.
2. **Open Acme's receipt.** It shows $53,251 MRR, +31% three-month growth, 12.3 months
   of runway and 31.6% customer concentration. Expand MRR to see the payments and method.
   Expand a paying customer to see simulated external research separately from
   invoice attribution and payment history. The simulation is explicitly labelled.
3. **Show founder controls.** Sign in at `/signin` using
   `founder+acme-ai@example.test` (or `founder+northstar-labs@example.test`). Open the
   magic link printed in this demo's terminal. Setup is no longer offered after that founder's
   company is connected. Add the email an investor will use to sign in, then send the monthly
   receipt. The dashboard lists every receipt for the connected company. Open any receipt to
   share that exact snapshot with an investor without subscribing them to monthly delivery.
4. **Open the monthly receipt.** The dashboard's August report shows July → August
   changes, Kittiwake as a new paying customer, the overdue Driftwood invoice, and
   concentration. “Send now” reuses an existing report and delivery for its month.
   The demo's prepared reports use the fixture's September 2026 anchor. Later
   manual sends use the actual current month, as they do outside the demo.
5. **Open the private investor portfolio.** Visit `/investor`, sign in as
   `investor@example.test`, and open the magic link printed in the terminal. Both
   demo companies appear because they delivered receipts to that address. Removing
   the address from a founder's investor list revokes that company's portfolio access.

## External research

Outside the demo, set `TAVILY_API_KEY` in `.env.local` for real customer searches.
Only a customer name and company billing domain are sent; no financial amounts,
transactions, bank tokens or full email addresses are sent. The adapter follows
the [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search).

Results are cached per connection and subject for 30 days and copied into each new
receipt. Viewing a published receipt performs no search. Missing configuration,
timeouts, invalid responses and provider errors produce **Needs review** and are
not cached as negative findings. A completed empty search produces **Flagged**,
with a note that this does not prove the business is absent. A related-party
ledger flag takes priority over a web result.

**Web match** means the customer name was found in a result hosted on its billing
domain (or a subdomain). A similarly named business on another domain does not
qualify. This is a web-presence check, not legal-identity certification. Searches
use the customer name and billing domain. The receipt separates billing-domain
evidence from supporting sources and shows legal registration as **Not checked**.
Available source excerpts are retained, but registration remains explicitly
unconfirmed; this version has no authoritative registry adapter.
Sample companies always bypass Tavily and show simulated research, even with a key.

Older receipts are preserved and say external research was not included. Use
**Issue a fresh receipt** to capture the research layer on a new link.

## Validation

`npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
If the local environment blocks Turbopack's worker socket, Next also supports
`npm run build -- --webpack`. The default build script remains unchanged.
