-- Supabase's Data API exposes every table in "public" to its anon and
-- authenticated roles. The app never uses that API: it connects as the table
-- owner, which bypasses RLS. Enabling RLS with no policies denies everyone else.
-- A test fails if a table is added without it.
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rho_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rho_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rho_transaction_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rho_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rho_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rho_invoice_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_research_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verificationToken" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipt_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "investor_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "monthly_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_deliveries" ENABLE ROW LEVEL SECURITY;
