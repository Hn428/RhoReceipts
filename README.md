# RhoReceipts
An agentic business validation service between founders and investors aimed at reducing time for due dillignece and better verifcation and source of Truth

A founder connects their Rho bank account once. Rho Receipts computes the numbers investors
ask for (MRR, burn, runway, growth, customer concentration) directly from bank
transactions, checks that the customers and vendors behind them exist, and shares a frozen,
auditable **receipt** with the investors the founder chooses. Every figure opens to the
transactions that produced it.

## Quick start

```bash
npm install
npm run demo
```

`npm run demo` seeds two sample companies (Acme AI and Northstar Labs) into a separate local
database and starts the app. Sign-in links print in the terminal, since no email is sent.
Follow the five-minute walkthrough in [docs/DEMO.md](docs/DEMO.md).

For development against your own database, copy `.env.example` to `.env.local`, fill in
`ENCRYPTION_KEY` and `AUTH_SECRET`, and run `npm run dev`.

## Reading a receipt

Receipts use a small set of chips. The most common:

| Label | Meaning |
|---|---|
| **AC-1057** | The invoice number a payment settled: revenue confirmed by an invoice |
| **Invoiced** | Rho linked this payment to an invoice the founder sent, so it's certain who paid and what for |
| **No invoice** | No bill is linked; the payment was counted as a customer's only because the sender's name on the deposit matches theirs, so it's an educated guess |
| **Aggregated** | A payment-processor payout covering many customers, which can't be split by customer |
| **Related party** | The counterparty both pays the company and is paid by it |
| **Spread over 12 months** | A prepayment divided across the months it covers |
| **Verified** / **Needs review** / **Flagged** | What external research found about a customer's identity |
| **Simulated match** | Sample companies: fictional customers get simulated research |
| **News** | Recent adverse news about a customer |

Green is confirmed, amber is unconfirmed, red is flagged, grey is neutral. **Every label,
flag and check is explained in [docs/KEY.md](docs/KEY.md).**

## Documentation

| Doc | Covers |
|---|---|
| [docs/KEY.md](docs/KEY.md) | Every label, chip and flag on receipts, reports and the portfolio |
| [docs/DEMO.md](docs/DEMO.md) | Demo walkthrough and how external research (Tavily, OpenAI) works |
| [docs/receipts.md](docs/receipts.md) | Enrollment, receipts, sharing and copy links |
| [docs/metrics.md](docs/metrics.md) | How transactions are classified and each metric is derived |
| [docs/ingestion.md](docs/ingestion.md) | Syncing the Rho ledger |
| [docs/database.md](docs/database.md) | Local PGlite and hosted Supabase |
| [docs/foundations.md](docs/foundations.md) | Money, periods, encryption, authentication |
| [docs/rho-api.md](docs/rho-api.md) | The Rho API and the demo fixtures |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What's built and what's next |

## Checks

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```
