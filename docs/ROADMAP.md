# Rho Receipts — Build Roadmap

## The idea

> **We turn financial activity into portable investor trust.**

A founder enrolls their bank ledger once. Receipts derives the numbers investors ask for,
checks that the customers behind them are real, and privately shares frozen receipts with
investors the founder chooses — then keeps those investors updated automatically.

## Architecture: four layers

| Layer | What it is | Status |
|---|---|---|
| **1. Financial data** | Mock Rho API + a mock Rho dashboard, clearly labelled as a simulation | Done |
| **2. Verification engine** | Deterministic classification and metrics | Done |
| **3. External trust** | Tavily customer web-presence research; labelled demo simulation | Done; authoritative registration verification remains unconfirmed |
| **4. Distribution** | Private investor portfolio and monthly investor receipts | Done |

No multi-agent system. The differentiation is the evidence, not the machinery.

## The demo, screen by screen

1. **Mock Rho Banking Environment** — one startup's accounts, balances, customer payments,
   payroll, SaaS spend and invoices. Establishes where the data comes from. Labelled as a
   simulation on every screen.
2. **Founder enrollment** — the founder opts in: connected accounts, transactions analysed,
   customers identified, then **Generate Rho Receipt**. Voluntary enrollment is what gives
   the badge meaning.
3. **Verified receipt** — the private page the founder shares. Headline figures, a paying
   customers table with verification status, and every figure opens to its receipts.
4. **Monthly investor receipt** — sent automatically to the investors a founder chooses.
   Month-over-month changes, new verified customers, and anything that needs a look.

**Founder flow:** mock Rho → enroll → metrics computed → customers researched → receipt
generated → shared → monthly receipts continue automatically.

**Investor flow:** opens the link from a deck → sees the badge → clicks a figure → sees the
transactions → clicks a customer → sees payment history and external verification.

## Product rules

1. **One company per founder account.** Setup disappears after connection, and the founder
   dashboard becomes that company's complete receipt history.
2. **Founders cannot edit financial figures.** They can only choose which investors receive
   monthly receipts. Every figure comes from the engine, and no write path reaches a snapshot.
3. **"Rho Receipts" is this project's name, not a Rho product.** Every page that shows the
   badge says so. The badge must never read as an official Rho certification.
4. **Simulated data is labelled as simulated.** The mock Rho environment and the sample
   companies say so wherever they appear. Customer research on fictional companies is
   simulated too — see the Tavily note below.

## Architectural invariants

1. **Arithmetic is deterministic code. Always.** No model computes, compares or rounds a
   figure. If an LLM is used at all, it only phrases text around numbers already decided.
2. **Money is integer minor units.** No floats, anywhere.
3. **Raw transactions are immutable.** Everything derived can be rebuilt from `rho_*` rows.
4. **Every figure carries its evidence** — the transaction ids and a stated method.
5. **Periods are explicit.** Half-open months in one declared timezone; reports use the
   last complete month.
6. **The Rho token is the crown jewel.** Encrypted, bound to its connection, never logged.
7. **Published receipts are snapshots.** A shared page or a sent report never changes
   after the fact. New numbers mean a new receipt.

---

## Done

| Phase | Result |
|---|---|
| Foundations | Money, periods, envelope encryption, validated env, magic-link auth. `docs/foundations.md` |
| Ingestion | Idempotent, versioned sync from the mock Rho API. `docs/ingestion.md` |
| Classification | Cash perimeter, graded attribution, related-party detection. `docs/metrics.md` |
| Metric engine | MRR, ARR, burn, runway, growth, concentration, each with evidence. `docs/metrics.md` |
| Private receipt v1 | Snapshot receipts at `/r/<slug>` with full drill-down. `docs/receipts.md` |

## Delivery milestones

### R1 — Demo company data and the mock Rho dashboard  *(screen 1)* — **DONE**
Northstar verified byte-identical after the generator refactor. Acme AI: MRR $53,251, +31.0% over 3 months, 12.3 months runway, top customer 31.6%. Mock Rho at `/mock-rho`.

The demo includes two separately owned companies so founder isolation and investor portfolio
access can be shown, while each founder account owns only one company.
- Generator produces one ledger per company profile. **Northstar Labs stays byte-identical**
  — its figures are pinned by the test suite.
- **Acme AI** becomes the headline company: faster growth, higher burn, a concentration
  risk, a customer who first paid in the reporting month, and an overdue invoice.
- Mock API serves each company by its own token.
- **Mock Rho dashboard** at `/mock-rho`: accounts, balances, and transactions grouped the
  way a banking app would show them, under a "Mock Rho Banking Environment" banner.

### R2 — Enrollment and profile alignment  *(screens 2 and 3)* — **DONE**
`/enroll` → review → Generate Rho Receipt. Profile has paying customers with 12-month payment history, 3-month growth, captions and the not-a-Rho-product disclosure.

- `/connect` becomes **enrollment**: import first, show what was found (accounts,
  transactions analysed, customers identified), then **Generate Rho Receipt**.
- Profile gains a **Paying customers** table with a verification column.
- Headline growth becomes **3-month revenue growth**. Month-over-month is noisy (Northstar's
  is +0.5%) and moves to the drill-down.
- Figures carry evidence captions: "from 18 settled customer payments".
- "Not an official Rho product" disclosure wherever the badge appears.
- Setup disappears after the first company is connected; direct attempts to connect a second
  company are rejected, and the dashboard lists that company's full receipt history.

### R3 — Monthly investor receipts  *(screen 5)* — **DONE**
Engine in `src/lib/metrics/monthly.ts` (13 tests, including cash reconstructed two independent ways). Recipients and Send now on the dashboard; report at `/m/<slug>`; cron at `/api/cron/monthly-receipts` (vercel.json, 1st of month, `CRON_SECRET` required in production). Verified: 4 sends → 1 email. Mail prints to the console until a provider is wired.

- Engine: compare two months — MRR, burn, runway and concentration deltas; customers whose
  first payment landed this month; invoices past due. All deterministic and tested.
- Founder manages **investor recipients** from the dashboard.
- One report per company per month, stored as a snapshot with its own link.
- **Automatic:** a cron route runs on the 1st and is idempotent — re-running never
  double-sends. The dashboard also has "Send now" for the demo.
- **Delivery:** development prints the email and records it in a delivery log shown on the
  dashboard, the same approach as sign-in links. A real mail provider is a transport swap.

### R4 — External trust layer (Tavily)  *(screen 3's verification column)* — **DONE**
Research runs at issuance, uses a connection-scoped 30-day cache, and is frozen into
the receipt. Provider failure is Needs review; related parties take priority. The
live adapter and failure paths are tested with controlled responses. A live-key
smoke test against Tavily's own site returned five sources and a matching-domain
Verified verdict. That test exposed overly restrictive search wording; searches
now use the name and domain, with a new cache version for future receipts.
Registration is explicitly unconfirmed; web search alone is not legal certification.
The receipt presents a billing-domain match, supporting Tavily sources and legal
registration as separate signals so a web result cannot imply a registry check.
- Research each paying customer: web presence, domain, registration footprint. Results are
  cached with their evidence so a verdict doesn't change on reload.
- Statuses: **Verified**, **Needs review**, **Flagged** (related party, or no footprint).
- **Sample companies use simulated research, labelled as such.** Their customers are
  fictional. A live web search on "Corvus Systems" either finds nothing or finds an
  unrelated real company with the same name — both would be wrong on screen. The live
  Tavily path runs for real companies.
- Needs `TAVILY_API_KEY`.

### R5 — Investor discovery — **REMOVED**
Public company discovery, comparison, and BetaWorks were removed. Companies appear only in
the authenticated portfolios of investors who received a receipt and remain authorized.

### R6 — Founder profile controls — **REMOVED**
Description, logo, and public-listing controls were removed. The founder dashboard manages
receipt issuance and explicit investor recipients only.

### R7 — Demo readiness — **DONE**
`npm run demo` prepares a separate database and starts the app. Repeat setup reuses
reports and delivery records. The walkthrough is in [DEMO.md](DEMO.md).
- One command seeds every company, founder and report so the demo starts from a known state.
- A written demo script covering the founder and private investor flows.

### Validation of R4–R7

149 tests pass, including in-memory Postgres migrations, complete demo imports,
repeat delivery prevention, research caching, private investor access,
and immutable snapshots. Typecheck, lint and the Webpack production build
pass. Default Turbopack build hit an environment socket-permission error.
The complete browser flow now passes: new-founder sign-in, Acme enrollment and
generation, simulated customer research and payment history, investor recipient creation,
monthly delivery, and repeat-send idempotency. Live Tavily credentials and
matching-domain verification have also passed a smoke test.

## Next milestones

### R8 — Figma UI refactor — **DONE**
Adapt the approved Figma Make demo to the working Next.js product while preserving
ledger-derived figures, immutable snapshots, server actions and disclosure rules.

- Landing design → `/`.
- Bank dashboard design → `/mock-rho/[company]`.
- Founder setup design → `/enroll` and `/enroll/[connectionId]`.
- Company profile and evidence designs → `/r/[slug]` and its drilldowns.
- Monthly receipt design → `/m/[slug]`.
- Use Inter-style UI typography, mono financial figures, off-white surfaces, charcoal
  text, verified green and hairline borders from the demo design system.

### R9 — Production Postgres — **NEXT**
Move from embedded PGlite to hosted Postgres, run migrations against a staging database,
and verify enrollment, receipt snapshots, research caching and idempotent delivery.

### R10 — Investor portfolio dashboard — **DONE**
Add an authenticated investor view based on the Figma Portfolio screen. Investors
see exact receipts shared directly with their signed-in email plus monthly reports
delivered to it. One-time receipt sharing does not subscribe the investor to future
monthly mail. The compact tables show MRR, runway and growth with evidence links.

- Add investor sign-in and role-aware routing while keeping founder ownership checks.
- Model explicit investor-to-company access from receipt recipients.
- Let a founder share any immutable receipt with an email directly from that receipt;
  the delivery is idempotent and appears in the investor portfolio.
- Add `Portfolio` to investor navigation; founder controls remain on `/dashboard`.

### R11 — Deployment and cron rehearsal — **REMINDER**
After Postgres is connected, deploy a staging build and run the monthly cron twice to
verify authentication, report reuse and duplicate-delivery prevention in the hosted
environment.

### Deferred integrations

- Keep terminal-printed magic links and receipt mail during the current build phase.
- Live Rho API verification is deferred while API access is unavailable; the mock API
  remains the demo source.

## Cut from the previous plan

- **Claim Checker.** Not in the workflow, and it was the main use of an LLM. If using the
  Anthropic API matters for the hackathon, the natural remaining place is phrasing the
  monthly receipt's summary or Tavily's evidence — text around numbers, never the numbers.
- **Redaction modes and view logs.** A demo shows one link; revocation stays on the list.
- **Founder review UI for classifications.** Rules in code are enough to demonstrate.

## Risk register

- **MRR from bank cash is approximate.** Disclose the method; show the transactions.
- **Aggregated payouts can't be attributed.** Say so rather than inventing a breakdown.
- **Real-looking verification on fictional customers.** Simulated research must be labelled,
  or the demo implies external checks that didn't happen.
- **Brand confusion with Rho.** The disclosure is a product rule, not a footnote.
- **Token custody.** A read-only token is still a full financial history.
