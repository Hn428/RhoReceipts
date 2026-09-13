/**
 * Monthly investor receipts: build, freeze, deliver.
 *
 * Every step is safe to repeat. The report for a month is created once and
 * then reused, never rebuilt — so a re-run can't change numbers investors have
 * already seen. Each delivery is claimed in the database before the email is
 * sent, so two runs racing each other still send each investor one email. A
 * re-run retries deliveries that failed or were left mid-send by a crash.
 */

import "server-only";

import { randomBytes } from "node:crypto";

import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  connections,
  investorRecipients,
  monthlyReports,
  receipts,
  reportDeliveries,
} from "@/lib/db/schema";
import { getOwnedConnection, syncConnection } from "@/lib/ingest/sync";
import { sendMail, STALE_CLAIM_MS, type MailMessage } from "@/lib/mail";
import type { CustomerRevenue } from "@/lib/metrics";
import { buildMonthlyReport, type Change, type ReportFlag } from "@/lib/metrics/monthly";
import { money, type Money } from "@/lib/money";
import {
  ENGINE_VERSION,
  companyNameFrom,
  getReceiptBySlug,
  issueReceipt,
  loadClassifiedLedger,
} from "@/lib/receipts";
import { RESEARCH_FLAG_REASONS, type CustomerResearch } from "@/lib/research/customer";
import { percent, whole } from "@/lib/receipts/format";

const CASH_ACCOUNT_TYPES = new Set(["checking", "savings", "investment"]);

export interface ReportSnapshot {
  version: 1;
  companyName: string;
  isDemo: boolean;
  asOf: string;
  receiptSlug: string;
  period: { key: string; label: string };
  previousPeriod: { key: string; label: string };
  mrr: Change;
  netBurn: Change;
  cash: { current: Money; previousMonthEnd: Money };
  runwayMonths: { current: number | null; previous: number | null };
  topCustomer: {
    current: { name: string | null; share: number | null };
    previous: { name: string | null; share: number | null };
  };
  growth3Month: number | null;
  newCustomers: (Pick<CustomerRevenue, "customerName" | "amount" | "attribution"> & {
    /** Absent on reports created before multi-signal research. */
    researchStatus?: CustomerResearch["status"];
  })[];
  missedCustomers: { customerName: string; previousAmount: Money }[];
  flags: ReportFlag[];
  /** Copied from the receipt issued with this report. Absent before multi-signal research. */
  research?: { verifiedShare: number | null; simulated: boolean };
}

export interface SendResult {
  slug: string;
  periodKey: string;
  periodLabel: string;
  /** False when this month's report already existed and was reused. */
  created: boolean;
  delivered: number;
  alreadyDelivered: number;
  failed: number;
  recipients: number;
}

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Produces this month's receipt for a connection and delivers it to every
 * recipient who hasn't had it yet.
 */
export async function sendMonthlyReport(options: {
  connectionId: string;
  ownerId: string;
  trigger: "cron" | "manual";
  asOf?: Date;
}): Promise<SendResult> {
  const db = getDb();
  const connection = await getOwnedConnection(options.connectionId, options.ownerId, db);
  if (!connection) throw new ReportError("Connection not found.");

  // Report on the freshest ledger Rho can give us.
  const sync = await syncConnection(connection.id, { trigger: `report-${options.trigger}` });
  if (sync.status === "failed") {
    throw new ReportError("Couldn't pull the latest activity from Rho.");
  }

  const asOf = options.asOf ?? new Date();
  const ledger = await loadClassifiedLedger(connection.id, options.ownerId);
  const cashAccounts = ledger.accounts.filter((a) => CASH_ACCOUNT_TYPES.has(a.account_type));
  const currency = ledger.accounts[0]?.balance.currency ?? "USD";

  const report = buildMonthlyReport({
    classifications: ledger.classifications,
    invoices: ledger.invoices,
    customers: ledger.customerRows.map((row) => row.payload),
    cashBalances: cashAccounts.map((a) => money(a.balance.amount, a.balance.currency)),
    cashAccountIds: cashAccounts.map((a) => a.id),
    asOf,
    currency,
  });

  // --- The month's report: created once, then reused -------------------------
  let [row] = await db
    .select()
    .from(monthlyReports)
    .where(and(eq(monthlyReports.connectionId, connection.id), eq(monthlyReports.periodKey, report.period.key)))
    .limit(1);
  let created = false;

  if (!row) {
    const { slug: receiptSlug } = await issueReceipt({
      connectionId: connection.id,
      ownerId: options.ownerId,
      asOf,
    });
    // The receipt just issued already researched this month's customers; read it
    // rather than researching again, so the report and its evidence agree.
    const issued = await getReceiptBySlug(receiptSlug);
    const research = issued?.snapshot.customerResearch ?? {};
    const companyName = companyNameFrom(connection.label);
    const snapshot: ReportSnapshot = {
      version: 1,
      companyName,
      isDemo: connection.baseUrl.includes("/api/mock/rho/"),
      asOf: asOf.toISOString(),
      receiptSlug,
      period: report.period,
      previousPeriod: report.previousPeriod,
      mrr: report.mrr,
      netBurn: report.netBurn,
      cash: report.cash,
      runwayMonths: report.runwayMonths,
      topCustomer: report.topCustomer,
      growth3Month: report.receipt.growth3Month.value,
      newCustomers: report.newCustomers.map(({ customerId, customerName, amount, attribution }) => ({
        customerName,
        amount,
        attribution,
        ...(customerId && research[customerId] ? { researchStatus: research[customerId].status } : {}),
      })),
      missedCustomers: report.missedCustomers.map(({ customerName, previousAmount }) => ({
        customerName,
        previousAmount,
      })),
      flags: [...report.flags, ...researchFlags(research, ledger.customerRows)],
      ...(issued?.snapshot.researchCoverage ? {
        research: {
          verifiedShare: issued.snapshot.researchCoverage.verifiedShare,
          simulated: issued.snapshot.researchCoverage.simulated,
        },
      } : {}),
    };

    const inserted = await db
      .insert(monthlyReports)
      .values({
        slug: randomBytes(9).toString("base64url"),
        connectionId: connection.id,
        ownerId: options.ownerId,
        periodKey: report.period.key,
        companyName,
        receiptSlug,
        asOf,
        engineVersion: ENGINE_VERSION,
        trigger: options.trigger,
        snapshot,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      row = inserted[0];
      created = true;
    } else {
      // Another run created it first; use theirs.
      [row] = await db
        .select()
        .from(monthlyReports)
        .where(and(eq(monthlyReports.connectionId, connection.id), eq(monthlyReports.periodKey, report.period.key)))
        .limit(1);
    }
  }

  const snapshot = row.snapshot as ReportSnapshot;

  // --- Deliveries: claim first, then send -------------------------------------
  const recipients = await db
    .select()
    .from(investorRecipients)
    .where(eq(investorRecipients.connectionId, connection.id));

  let delivered = 0;
  let alreadyDelivered = 0;
  let failed = 0;

  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);

  for (const recipient of recipients) {
    let [claim] = await db
      .insert(reportDeliveries)
      .values({ reportId: row.id, email: recipient.email, status: "sending", transport: "pending" })
      .onConflictDoNothing()
      .returning();
    if (!claim) {
      // Retake a failed delivery, or one that crashed mid-send and never finished.
      [claim] = await db
        .update(reportDeliveries)
        .set({ status: "sending", error: null, claimedAt: new Date() })
        .where(
          and(
            eq(reportDeliveries.reportId, row.id),
            eq(reportDeliveries.email, recipient.email),
            or(
              eq(reportDeliveries.status, "failed"),
              and(eq(reportDeliveries.status, "sending"), lt(reportDeliveries.claimedAt, staleBefore)),
            ),
          ),
        )
        .returning();
    }
    if (!claim) {
      alreadyDelivered += 1;
      continue;
    }

    try {
      const result = await sendMail({
        ...renderReportEmail(snapshot, row.slug, recipient.name),
        to: recipient.email,
      });
      await db
        .update(reportDeliveries)
        .set({ status: "sent", transport: result.transport, sentAt: new Date(), error: null })
        .where(eq(reportDeliveries.id, claim.id));
      delivered += 1;
    } catch (error) {
      console.error("Monthly receipt delivery failed", error);
      await db
        .update(reportDeliveries)
        .set({ status: "failed", error: error instanceof Error ? error.message : String(error) })
        .where(eq(reportDeliveries.id, claim.id));
      failed += 1;
    }
  }

  return {
    slug: row.slug,
    periodKey: snapshot.period.key,
    periodLabel: snapshot.period.label,
    created,
    delivered,
    alreadyDelivered,
    failed,
    recipients: recipients.length,
  };
}

/**
 * Research findings worth a line in the report. Related parties are already
 * flagged from the ledger, so only the identity flags research adds appear here.
 */
function researchFlags(
  research: Record<string, CustomerResearch>,
  customerRows: { rhoCustomerId: string; legalName: string }[],
): ReportFlag[] {
  const names = new Map(customerRows.map((row) => [row.rhoCustomerId, row.legalName]));
  const flags: ReportFlag[] = [];
  for (const [customerId, result] of Object.entries(research)) {
    const customerName = names.get(customerId) ?? "Unknown customer";
    const simulated = result.provider === "simulated";
    const identity = (result.flags ?? []).filter((flag) => flag !== "related_party" && flag !== "adverse_news");
    if (identity.length) {
      flags.push({ kind: "research_flagged", customerName, simulated, reason: identity.map((flag) => RESEARCH_FLAG_REASONS[flag]).join(" ") });
    }
    if (result.flags?.includes("adverse_news")) {
      flags.push({ kind: "adverse_news", customerName, simulated, headline: result.signals?.news.sources[0]?.title ?? null });
    }
  }
  return flags.sort((a, b) => a.customerName.localeCompare(b.customerName));
}

/** Every enrolled connection — one with at least one published receipt. */
export async function enrolledConnections() {
  const db = getDb();
  const published = await db.selectDistinct({ connectionId: receipts.connectionId }).from(receipts);
  if (published.length === 0) return [];
  return db
    .select()
    .from(connections)
    .where(inArray(connections.id, published.map((p) => p.connectionId)));
}

export async function getReportBySlug(slug: string) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(slug)) return null;
  const [row] = await getDb().select().from(monthlyReports).where(eq(monthlyReports.slug, slug)).limit(1);
  return row ? { ...row, snapshot: row.snapshot as ReportSnapshot } : null;
}

export async function reportsFor(connectionId: string, ownerId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(monthlyReports)
    .where(and(eq(monthlyReports.connectionId, connectionId), eq(monthlyReports.ownerId, ownerId)))
    .orderBy(desc(monthlyReports.periodKey));
  if (rows.length === 0) return [];
  const deliveries = await db
    .select()
    .from(reportDeliveries)
    .where(inArray(reportDeliveries.reportId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    ...r,
    snapshot: r.snapshot as ReportSnapshot,
    deliveries: deliveries.filter((d) => d.reportId === r.id),
  }));
}

/**
 * The newest receipt actually delivered to each company that currently grants
 * this investor access. Both conditions matter: removing a recipient revokes
 * portfolio access, and an unsent report never appears as though it was shared.
 */
export async function reportsSharedWithInvestor(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return [];

  const db = getDb();
  const grants = await db
    .select({ connectionId: investorRecipients.connectionId })
    .from(investorRecipients)
    .where(eq(investorRecipients.email, normalizedEmail));
  if (grants.length === 0) return [];

  const reports = await db
    .select()
    .from(monthlyReports)
    .where(inArray(monthlyReports.connectionId, grants.map((grant) => grant.connectionId)))
    .orderBy(desc(monthlyReports.periodKey), desc(monthlyReports.createdAt));
  if (reports.length === 0) return [];

  const deliveries = await db
    .select({ reportId: reportDeliveries.reportId })
    .from(reportDeliveries)
    .where(
      and(
        inArray(reportDeliveries.reportId, reports.map((report) => report.id)),
        eq(reportDeliveries.email, normalizedEmail),
        eq(reportDeliveries.status, "sent"),
      ),
    );
  const deliveredReportIds = new Set(deliveries.map((delivery) => delivery.reportId));
  const newestByConnection = new Map<string, (typeof reports)[number]>();

  for (const report of reports) {
    if (deliveredReportIds.has(report.id) && !newestByConnection.has(report.connectionId)) {
      newestByConnection.set(report.connectionId, report);
    }
  }

  return [...newestByConnection.values()].map((report) => ({
    ...report,
    snapshot: report.snapshot as ReportSnapshot,
  }));
}

export async function recipientsFor(connectionId: string, ownerId: string) {
  return getDb()
    .select()
    .from(investorRecipients)
    .where(and(eq(investorRecipients.connectionId, connectionId), eq(investorRecipients.ownerId, ownerId)))
    .orderBy(investorRecipients.createdAt);
}

// ----------------------------------------------------------------------- email

function arrow(change: Change, format: (m: Money) => string) {
  return change.previous ? `${format(change.previous)} → ${format(change.current)}` : format(change.current);
}

export function describeFlag(flag: ReportFlag): string {
  switch (flag.kind) {
    case "overdue_invoice":
      return `${flag.customerName}: invoice ${flag.invoiceNumber} for ${whole(flag.amount)} is ${flag.daysOverdue} days overdue.`;
    case "concentration":
      return `${flag.customerName} is ${percent(flag.share)} of revenue.`;
    case "needs_review":
      return `${flag.customerName}: ${whole(flag.amount)} of revenue has no invoice behind it.`;
    case "research_flagged":
      return `${flag.customerName}: ${flag.simulated ? "simulated research — " : ""}${flag.reason}`;
    case "adverse_news":
      return flag.simulated
        ? `${flag.customerName}: simulated news reports layoffs at this customer.`
        : `${flag.customerName}: recent news mentions adverse terms${flag.headline ? ` — "${flag.headline}"` : ""}.`;
    case "related_party":
      return `${flag.customerName} both pays the company and is paid by it (${whole(flag.moneyIn)} in, ${whole(money(-flag.moneyOut.minor, flag.moneyOut.currency))} out).`;
  }
}

function renderReportEmail(
  snapshot: ReportSnapshot,
  slug: string,
  recipientName: string | null,
): Omit<MailMessage, "to"> {
  const reportUrl = `${appUrl()}/m/${slug}`;
  const receiptUrl = `${appUrl()}/r/${snapshot.receiptSlug}`;
  const runway = (months: number | null) => (months === null ? "not burning" : `${months} months`);

  const lines: [string, string][] = [
    ["MRR", `${arrow(snapshot.mrr, whole)}${snapshot.mrr.change !== null ? ` (${percent(snapshot.mrr.change, { signed: true })})` : ""}`],
    ["Net burn", arrow(snapshot.netBurn, whole)],
    ["Runway", `${runway(snapshot.runwayMonths.previous)} → ${runway(snapshot.runwayMonths.current)}`],
    ["Largest customer", `${percent(snapshot.topCustomer.previous.share)} → ${percent(snapshot.topCustomer.current.share)}`],
  ];

  const text = [
    `${recipientName ? `Hi ${recipientName},` : "Hi,"}`,
    "",
    `${snapshot.companyName}'s ${snapshot.period.label} receipt is ready. Every figure is computed from bank records.`,
    "",
    ...lines.map(([label, value]) => `${label.padEnd(18)} ${value}`),
    ...(snapshot.newCustomers.length
      ? ["", `New customers: ${snapshot.newCustomers.map((c) => c.customerName).join(", ")}`]
      : []),
    ...(snapshot.flags.length ? ["", "Worth a look:", ...snapshot.flags.map((f) => `- ${describeFlag(f)}`)] : []),
    "",
    `Read the receipt: ${reportUrl}`,
    `See every transaction: ${receiptUrl}`,
    ...(snapshot.isDemo ? ["", "Sample company — figures come from a simulated ledger."] : []),
    "",
    "Rho Receipts is an independent project, not a Rho product.",
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#eef1ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111816">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fbfcfb;border:1px solid #d8dfdc">
<tr><td style="padding:28px 28px 8px"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#55615d">Monthly receipt · ${snapshot.period.label}</div>
<div style="font-family:Georgia,serif;font-size:30px;line-height:1.1;margin-top:8px">${escapeHtml(snapshot.companyName)}</div></td></tr>
<tr><td style="padding:12px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${lines.map(([label, value]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #d8dfdc;font-size:14px">${label}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #d8dfdc;font-family:Menlo,monospace;font-size:14px">${escapeHtml(value)}</td></tr>`).join("")}
</table></td></tr>
${snapshot.newCustomers.length ? `<tr><td style="padding:8px 28px;font-size:14px"><strong>New customers:</strong> ${snapshot.newCustomers.map((c) => escapeHtml(c.customerName)).join(", ")}</td></tr>` : ""}
${snapshot.flags.length ? `<tr><td style="padding:8px 28px;font-size:14px"><strong>Worth a look</strong><ul style="margin:6px 0 0;padding-left:18px;color:#55615d">${snapshot.flags.map((f) => `<li style="margin:4px 0">${escapeHtml(describeFlag(f))}</li>`).join("")}</ul></td></tr>` : ""}
<tr><td style="padding:20px 28px 28px"><a href="${reportUrl}" style="display:inline-block;background:#111816;color:#fbfcfb;text-decoration:none;padding:10px 16px;font-size:14px">Read the receipt</a>
<div style="margin-top:14px;font-size:12px;color:#7f8b87">Figures computed from bank records.${snapshot.isDemo ? " Sample company — simulated ledger." : ""} Rho Receipts is an independent project, not a Rho product.</div></td></tr>
</table></td></tr></table></body></html>`;

  return {
    subject: `${snapshot.companyName} — ${snapshot.period.label} receipt`,
    text,
    html,
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
