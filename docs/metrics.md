# Classification and metrics

Two pure modules. No I/O, no clock, no model — an LLM may later phrase a verdict,
never compute one. `npm test` covers them with 106 tests against the fixture.

- `src/lib/classify/` — what each transaction *means*
- `src/lib/metrics/` — the arithmetic, with evidence attached

## The cash perimeter

One idea resolves transfers, card spend and repayments without double-counting.

**Cash is checking, savings and investment.** Card and rewards accounts sit
outside. Money moving *within* the perimeter is not income or spend and nets to
zero; money *crossing* the boundary genuinely leaves.

| Case | Verdict |
|---|---|
| $250k treasury sweep (checking → treasury) | Both legs inside → excluded |
| Card swipe on the credit account | Outside the perimeter → not cash |
| Card bill paid from checking | Crosses the boundary → real spend |
| Vendor debit later returned | Legs cancel on one account → reversed, excluded |

Card spend is counted once, when the bill is paid.

## When unsure, exclude from revenue

Overstating revenue destroys trust; understating is recoverable and visible.
Unmatched inflows land in `unclassified` and are reported as excluded rather
than quietly counted. The offline cheque from Larkspur Municipal District is real
revenue the system refuses to claim, because nothing links it to a customer.

## Attribution is graded, never blended

| Grade | Meaning | Fixture |
|---|---|---|
| `invoice` | Rho links the payment to the customer. No inference. | 12 customers |
| `name_match` | Descriptor matches a customer on file; no invoice backs it. | Cobalt Holdings |
| `aggregated` | A processor payout covering many customers. Not attributable. | Stripe, 70 payouts |
| `none` | Not revenue. | — |

The receipt shows the grade. A number that was confirmed and a number that was
inferred must never look alike.

## Related-party flows

A payment to a company that is also a customer is **not** a refund. Netting the
two would have shown Quill & Stone at −$500 and hidden $127,500 in and $126,000
out. A genuine refund is identified by memo language (`refund`, `credit memo`,
`chargeback`); everything else is spend, and both directions are flagged
`relatedParty`. Not proof of wrongdoing — but it is the first thing diligence
looks for, so the receipt surfaces it.

## Revenue recognition

Payments are spread across the months they cover, using the invoice line item's
quantity — read from the data, not guessed. Atlas Freight's $96,000 annual
prepayment becomes $8,000 across twelve months. `allocate` guarantees the parts
sum back exactly.

Unamortised, that single payment would spike one month, flatten eleven, and
corrupt MRR, growth and burn simultaneously.

## Metrics

Every value carries `transactionIds` and a plain-English `method`. The IDs are
the drill-down; the method is what the receipt discloses.

| Metric | Derivation |
|---|---|
| MRR | Recognised revenue in the last **complete** month |
| ARR | MRR × 12 |
| Net burn | Operating cash out − in; financing, transfers and interest excluded |
| Runway | Cash ÷ average burn over 3 complete months |
| Growth | Month-over-month change in recognised revenue |
| Concentration | Each customer's share of trailing-12-month revenue |

The reporting period is the last complete month, never the one in progress.
Including a 12-day-old September would understate burn by roughly a third and
overstate runway by the same margin.

## What it produces on the fixture

```
Reporting period 2026-08 (last complete month)

MRR                $135,006.00   18 transactions
ARR              $1,620,072.00
Growth (MoM)              0.5%
Net burn            $56,360.00   25 transactions
Cash on hand     $1,771,069.76
Runway             15.8 months
Top customer             18.8%   Corvus Systems, Inc.
Top 5                    60.4%

Excluded:  financing $3,250,000 (2) · other income $40,729 (31)
           unclassified $7,500 (1) · internal transfers $0 net (10)
```

`buildReceipt` also returns `excluded`, so the page can show what was left out
and why — the $3.25M of investment is stated, not silently dropped.
