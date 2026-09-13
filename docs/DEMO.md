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
   Above the customers, 80.2% of revenue is from customers whose web presence checks
   out. Expand a paying customer to see the four research checks (simulated for these
   fictional customers, and labelled). In **Worth a closer look**, Greyfield has no invoice
   and no footprint, and Driftwood has simulated layoff news. Under Net burn, open
   **Largest vendors** for live Tavily checks on real vendors.
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

Research runs when a receipt is issued, is cached per connection for 30 days, and is
frozen into the receipt. Viewing a receipt performs no search. It needs
`TAVILY_API_KEY`; judging the evidence with a model also needs `OPENAI_API_KEY`.
Tavily receives customer and vendor names and company billing domains. OpenAI receives
those plus the public web text Tavily returned. Neither receives amounts, transactions,
bank tokens or email addresses.

### Customers

Researched: everyone behind the month's revenue, the five largest customers over
twelve months, and anyone with an overdue invoice. Each gets four checks, in
parallel:

| Check | Tavily call | Found means |
|---|---|---|
| Website | Extract the billing domain's homepage | The page names the company. A parked or for-sale page is flagged |
| Search results | Search name + domain | A result hosted on the billing domain names the company |
| Registry sites | Search limited to OpenCorporates, SEC EDGAR, Companies House | A listing's title names the company. A web result, not a registry query |
| News | News search, last 12 months | Results naming the company; adverse terms (layoffs, lawsuit, insolvency…) are called out |

#### Who reads the evidence

Tavily only gathers. Deciding what the evidence shows is a separate step:

- **With `OPENAI_API_KEY`**, one Responses API call per customer (`src/lib/research/judge.ts`,
  model `OPENAI_RESEARCH_MODEL`, default `gpt-5.6-sol` at low reasoning effort) answers
  four questions with a strict JSON schema. Does the homepage identify the company? Which
  on-domain search result identifies it, quoting it? Is a registry result the *same legal
  entity* (name, legal form, jurisdiction)? Is each news article about this company, and
  is it adverse? Scraped text is passed as untrusted data.
- **Code checks every positive answer before counting it.** The quote must appear in the
  cited source, and a search result must be on the billing domain. Otherwise it doesn't
  count, and the receipt says why. The model's reasoning is shown beside each check.
- **Without a key**, or if the call fails, fixed string rules decide: whole-name match,
  billing-domain host match, and adverse keyword list. A result that fell back because the
  model failed isn't cached, so the next receipt retries it.

The model fixes what string rules can't: "Stripe, Inc." vs a UK "Stripe Ltd" registry
entry, a lawsuit the company *won*, and news about a same-name business. At about 4k tokens
in and 500 out, Sol costs about $0.03 per customer; `gpt-5.6-luna` is about 20× cheaper.

#### Status

Status comes from fixed rules in `deriveVerdict`, never from Tavily or the model:

- **Flagged:** related party (ledger), billing domain equals the founder's own email
  domain, parked domain, or **no footprint**: no homepage match, an empty search, and
  no registry listing.
- **Verified:** the homepage or a search result on the billing domain names the company.
- **Needs review:** everything else, including provider failures.

Adverse news is shown beside the status, not folded into it. A failed check is
**Unavailable**, is never a negative finding, and a result with one isn't cached, so the
next receipt retries it. Tavily's one-line company summary is shown as generated text
and never affects a verdict.

The receipt shows the split of the month's revenue by status ("80.2% from
customers whose web presence checks out"). Flags appear in **Worth a closer look**
and the monthly report, and investors see verified revenue in their portfolio.

### Sample companies

There are four sample companies. **Acme AI** and **Northstar Labs** have fictional customers,
and a live search would describe an unrelated real business, so their customer research is
**simulated from the ledger** and labelled:
invoiced customers verify, customers paid without an invoice have no footprint
(Greyfield Trading, Cobalt Holdings), and a customer with an overdue invoice has
simulated layoff news (Driftwood Logistics).

**Vendors are real,** so the eight largest payees across the burn months, including
card purchases, are searched **live** even in the demo. `npm run demo` passes the
Tavily key from `.env`/`.env.local` through to seeding. A match means a business by
that name has a public footprint, not that it's the business that was paid. Acme's
annotation contractor, Vasquez Annotation SRL, has none and appears in **Worth a
closer look**.

**Quiverleaf AI** and **Lanternfish Analytics** are fictional startups whose customers and
vendors are **real businesses named for illustration** (Notion, Figma, Vercel, Linear, Canva,
Webflow; Allbirds, Warby Parker, Glossier, Bombas…). Their ledgers are as synthetic as Acme's:
every payment, invoice and relationship is invented, and no business relationship is implied.
Because the customers are real, their research runs **live** through Tavily and the OpenAI
judge, and each receipt carries a disclosure saying so. They're marked `real_customers` in
their fixture `meta.json`.

**They aren't sample-company buttons.** A founder connects them the way a real company would:
open `/enroll`, choose **Connect with a token**, and paste the company's token. Each token is also
shown on the company's (unlisted) Mock Rho page under **API access**.

| Company | Mock Rho page | Token |
|---|---|---|
| Quiverleaf AI | `/mock-rho/quiverleaf-ai` | `rhobat_mock_quiverleaf_ai_dev_token` |
| Lanternfish Analytics | `/mock-rho/lanternfish-analytics` | `rhobat_mock_lanternfish_analytics_dev_token` |

These tokens aren't secrets: they only open a simulated ledger on the mock API. They're marked
`token_only` in their fixture `meta.json`, which keeps them out of the sample list and the
Mock Rho company switcher.

They exercise cases the simulation can't: a brand that differs from the legal name (Linear
Orbit, Inc. at linear.app), UK and Australian entities with similar names in registries, and
real adverse news (a reported breach at Vercel; layoffs at Webflow and Glossier). `npm run demo` doesn't seed them, since every reset would
research their customers live again.

Cost is roughly 3.2 Tavily credits per live customer (search, extract, registry, news)
plus one model call when configured, and 1 credit per vendor, cached for 30 days. Vendor
checks use the string rules only. Fictional customers never reach Tavily or the model. Older receipts keep their original research layout.

## Validation

`npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
If the local environment blocks Turbopack's worker socket, Next also supports
`npm run build -- --webpack`. The default build script remains unchanged.
