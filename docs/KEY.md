# Reading a receipt: labels and flags

Every chip, badge and flag the app shows, what it means, and why it appears. Labels are
written exactly as they appear on screen.

**None of these labels is an accusation.** A flag marks a place where a careful investor
would ask a follow-up question. The receipt always links it to the transactions or sources
behind it.

## Colours

| Colour | Means |
|---|---|
| Green | Confirmed: an invoice, a verified identity, or a check that found what it looked for |
| Amber | Unconfirmed: inferred rather than proven, or a check that found no match. Worth a look |
| Red | Flagged: something an investor should look into |
| Grey | Neutral information, or a check that didn't run |

## Page badges

| Label | Where | Meaning |
|---|---|---|
| **Verified by Rho Receipts** | Receipt and monthly report header | Every figure was computed from a read-only bank connection by fixed rules; nothing was typed in. Rho Receipts is an independent project, so this is **not** a certification from Rho. |
| **Sample company** / **Simulated data** | Receipts, reports, portfolio | The ledger is synthetic demo data, not a real bank account. For Acme AI and Northstar Labs, the customers are fictional and their research is simulated. For Quiverleaf AI and Lanternfish Analytics, the customers are real businesses named for illustration: the payments and relationships are invented, but research on them ran live, and the receipt says so. |
| **Bank-derived** | Investor portfolio | The figures come from a real Rho connection. |
| **No. Qe1w8aPfi-43** | Receipt header | The receipt's ID, which is also its private link (`/r/<id>`). A receipt is a frozen snapshot, so new figures mean a new number. |

## On a transaction row

Opening any figure lists the bank transactions behind it. A row can carry:

| Label | Meaning |
|---|---|
| **AC-1057**, **NS-1001** (letters, dash, number) | The **invoice number** this payment settled, so the revenue is confirmed by an invoice rather than inferred. The number is the company's own: in the demo, `AC-` invoices belong to Acme AI and `NS-` to Northstar Labs. |
| **Related party** | This counterparty both **pays the company and is paid by it**. Both directions are shown in full and never netted against each other; netting is how a circular flow disappears. Genuine refunds, identified by memo words like *refund* or *chargeback*, don't trigger it. |
| **Spread over 12 months** | The payment covers several months (for example, an annual prepayment), so it's divided across those months instead of counted in one. The month count comes from the invoice line item, not a guess. |
| **pending**, **failed**, **awaiting approval** | The transaction hasn't settled, so no money has moved. It's excluded from every figure. |

The small grey line under a row shows the memo and the account it posted to.

## How a payment is attributed to a customer

A bank deposit doesn't say what it's for. All the bank records is who sent it and an amount,
like `Cobalt Holdings Group · +$10,000`. To count it as revenue, Rho Receipts has to know it
came from a customer, and there are two ways to know:

| Label | How the app knows who paid | How sure it is |
|---|---|---|
| **Invoiced** | The founder billed the customer through Rho's invoicing. When the customer paid, Rho itself linked the payment to that invoice, whose number (e.g. **NS-1136**) appears on the transaction. | **Certain.** There's a bill behind it: who paid, what for, and for how much. |
| **No invoice** | No bill is linked. The only clue is the sender's name on the deposit ("Cobalt Holdings Group"), which matches a name on the customer list, so the payment is counted as that customer's revenue. | **A guess.** It's probably the customer paying outside the invoicing system, but it could be a loan, an investor, or money routed through a company with a matching name. |
| **Aggregated** | A payout from a payment processor (Stripe, PayPal, Square…) that bundles many customers' card payments into one deposit. | **Real revenue, unknown customers.** It can't be split by customer, so it can't be researched individually. |

**Why it matters:** invoiced revenue can be checked against the bill; revenue with no invoice
has nothing behind it but a matching name. Both count toward MRR, but they're labelled
differently so a confirmed number never looks like an inferred one.

In the Northstar demo, Meridian Health Group was billed $12,400 on invoice **NS-1136** on
July 28 and paid it on August 6, so that payment is **Invoiced**. Cobalt Holdings Group
deposits a round $10,000 on the 1st of every month with no invoice behind any of it, so it's
**No invoice**, and it also appears in *Worth a closer look*.

## Customer verification

The **Verification** column in *Paying customers* shows what external research found about
each customer, researched with Tavily when the receipt was issued.

| Label | Meaning |
|---|---|
| **Verified** | The customer's own homepage, or a search result hosted on its billing domain, identifies the company. This confirms web presence, **not** legal identity or that the payments are legitimate. |
| **Simulated match** | Sample companies only. The customer is fictional, so no live search ran. Customers backed by invoices are simulated as verified. |
| **Web match** | Older receipts only: the same meaning as *Verified*, from before multi-check research. |
| **Needs review** | Research ran but couldn't confirm identity: the website didn't name the company, there's no company-specific billing domain (for example a Gmail address), or a check failed. Not a negative finding. |
| **Flagged** | One of the reasons below applies. |
| **Not researched** | The customer wasn't researched: an older receipt, or a payment that can't be tied to one customer. |
| **News** | Recent news about this customer describes adverse events (layoffs, insolvency, lawsuits or regulatory action against it, fraud, a data breach). Shown **beside** the status, because it doesn't change whether the customer is who it claims to be. |

A customer is **Flagged** when any of these is true:

| Reason | Meaning |
|---|---|
| Related party | Bank records show the customer both pays and is paid by the company. |
| Founder's own domain | The customer's billing email domain is the founder's own email domain. |
| Parked domain | The billing domain's homepage exists only to sell or park the domain. |
| No footprint | The homepage doesn't identify the company, the search found nothing, and no registry lists it. A review flag, not proof the customer doesn't exist. |

### The four checks inside a customer

Opening a customer shows four checks. The dot colour follows the colour key above.

| Check | Possible results |
|---|---|
| **Website**: the billing domain's homepage | **Names the company** · **No match** (doesn't identify it, or couldn't be reached) · **Parked domain** |
| **Search results**: a search for the name and domain | **Name on domain**, meaning a result *on the billing domain* identifies it. Results on other sites never count. · **No match** |
| **Registry sites**: OpenCorporates, SEC EDGAR, UK Companies House | **Listing found**: a listing for the same entity was found by *web search* of those sites, not by querying a registry directly · **No listing** (none found, or listings were for a different entity, e.g. a UK *Ltd* when the customer is a US *Inc.*) |
| **News, 12 months** | **Nothing adverse** · **No coverage** (grey: no news is neutral) · **Adverse terms** |

Any check can also show **Unavailable** (the provider failed; never counted against the
customer) or **Not checked** (it didn't apply, usually because there's no company domain).

**Who judged the evidence.** The panel footer says which applied:

- *Judged by OpenAI*: a model read the sources and answered each check. Its reasoning is
  shown under the check. A positive answer only counts if the text it quoted is really in
  the cited source.
- *Matched by fixed text rules*: exact name and domain matching, used when no model is
  configured or the model call failed.

Code, never the model, turns the checks into Verified, Needs review or Flagged. A one-line
company description marked *generated by Tavily* is context only and never affects a
verdict.

### The verification bar

Above the customer list, the month's revenue is split by research status:

| Segment | Meaning |
|---|---|
| **Verified · n** | Revenue from verified customers. The headline percentage is this share. |
| **Needs review · n** | Revenue from customers research couldn't confirm. |
| **Flagged · n** | Revenue from flagged customers. |
| **Can't be researched** | Processor payouts, which can't be tied to individual customers. |

The counts cover every customer with an identity (invoiced or not), matching "*n* paying
customers" in the sentence above the bar. The amounts add up to MRR.

## Worth a closer look

Chips used in this section:

| Label | Meaning |
|---|---|
| **Related party** | As above, with money in and money out shown separately. |
| **No invoice** | Revenue counted from a name match with no invoice. If research also flagged the customer, its status chip and reason appear alongside. |
| **Flagged** / **Needs review** | A customer research flagged, with the reason. Customers already listed above (related parties, no invoice) aren't repeated. |
| **News** | The latest adverse headline; open the customer for sources. |
| **Vendor not found** | One of the largest vendors has no public web footprint. Worth asking what that spend is for. |
| **Aggregated** | This month's processor payouts, which can't be attributed. |

## Largest vendors

Under **Net burn**, the largest payees across the burn months, card purchases included,
are checked live on the web, even for sample companies, since vendors are real businesses.

| Label | Meaning |
|---|---|
| **Found** | Public web results name a business by this name. This doesn't confirm it's the same business that was paid. |
| **No footprint** | No public result names a business by this name. |
| **Unavailable** | The web check didn't complete. |

## Left out of these figures

Every transaction is accounted for. These groups are excluded, with the reason:

| Group | Why it's excluded |
|---|---|
| **Investment and loans** | Money from investors or lenders: real cash, but not revenue. |
| **Transfers between own accounts** | Nets to zero; counting either side would inflate revenue and burn. |
| **Interest and rewards** | Interest, treasury yield and card rewards: not earned from customers. |
| **Card and rewards account activity** | Card swipes are counted once, when the card bill is paid from checking. |
| **Pending, failed or awaiting approval** | Hasn't cleared, so no money has moved. |
| **Money in we couldn't explain** | Couldn't be linked to a customer, investor or known source, so it's left out rather than guessed at. |
| **Reversed payments** | Returned in full, so they net to zero. |

## Accounts

| Label | Meaning |
|---|---|
| **Checking**, **Savings**, **Treasury** | Counted as cash on hand. |
| **Card**, **Rewards** | Listed under *Not counted as cash*. |

## Monthly report

| Label | Meaning |
|---|---|
| **New customers** | First paid in this month. The chip shows their research status. |
| **No payment this month** | Paid last month but not this month. |
| **Investor watch** | The month's flags, listed below. |

Investor watch items:

| Item | Appears when |
|---|---|
| *invoice … is N days overdue* | An unpaid, uncancelled invoice is past its due date. |
| *… is N% of revenue* | The largest customer is more than 30% of revenue. |
| *… has no invoice behind it* | Revenue counted from a name match with no invoice. |
| *… both pays the company and is paid by it* | A related party. |
| *simulated research — …* / research reason | Research flagged a customer's identity. |
| *recent news mentions adverse terms* | Adverse news about a customer (simulated for sample companies). |

## Investor portfolio

| Column | Meaning |
|---|---|
| **MRR**, **Runway**, **3-month growth** | From the shared receipt or monthly update, as issued. |
| **Verified revenue** | The share of that month's revenue from verified customers (the verification bar's headline). *Simulated research* marks sample companies; *Not researched* marks receipts issued before research existed. |
