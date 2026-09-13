CREATE TABLE "account_balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"balance_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"token_ciphertext" text,
	"token_ref" text,
	"base_url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"synced_through" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rho_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"rho_account_id" text NOT NULL,
	"account_type" text NOT NULL,
	"account_name" text,
	"account_number_last_4" text,
	"routing_number_last_4" text,
	"balance_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"balance_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rho_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"rho_customer_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"email" text,
	"email_domain" text,
	"total_revenue_minor" bigint,
	"currency" text,
	"deleted_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rho_invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"payment_type" text NOT NULL,
	"external_method" text,
	"paid_at" timestamp with time zone,
	"rho_transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rho_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"rho_invoice_id" text NOT NULL,
	"invoice_number" text,
	"status" text NOT NULL,
	"rho_customer_id" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rho_transaction_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"sync_run_id" uuid,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"posted_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rho_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"rho_transaction_id" text NOT NULL,
	"rho_money_movement_id" text NOT NULL,
	"rho_account_id" text NOT NULL,
	"account_type" text NOT NULL,
	"account_name" text,
	"transaction_type" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"initiated_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"counterparty_name" text NOT NULL,
	"counterparty_logo_url" text,
	"memo" text,
	"note" text,
	"user_id" text,
	"user_full_name" text,
	"card_id" text,
	"card_name" text,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"window_start" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_id_rho_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."rho_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rho_accounts" ADD CONSTRAINT "rho_accounts_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rho_customers" ADD CONSTRAINT "rho_customers_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rho_invoice_payments" ADD CONSTRAINT "rho_invoice_payments_invoice_id_rho_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."rho_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rho_invoice_payments" ADD CONSTRAINT "rho_invoice_payments_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rho_invoices" ADD CONSTRAINT "rho_invoices_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rho_transaction_versions" ADD CONSTRAINT "rho_transaction_versions_transaction_id_rho_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."rho_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rho_transactions" ADD CONSTRAINT "rho_transactions_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshots_account_idx" ON "account_balance_snapshots" USING btree ("account_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_label_idx" ON "connections" USING btree ("label");--> statement-breakpoint
CREATE UNIQUE INDEX "rho_accounts_natural_key" ON "rho_accounts" USING btree ("connection_id","rho_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rho_customers_natural_key" ON "rho_customers" USING btree ("connection_id","rho_customer_id");--> statement-breakpoint
CREATE INDEX "rho_invoice_payments_txn_idx" ON "rho_invoice_payments" USING btree ("connection_id","rho_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rho_invoice_payments_unique" ON "rho_invoice_payments" USING btree ("invoice_id","rho_transaction_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rho_invoices_natural_key" ON "rho_invoices" USING btree ("connection_id","rho_invoice_id");--> statement-breakpoint
CREATE INDEX "rho_invoices_customer_idx" ON "rho_invoices" USING btree ("connection_id","rho_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rho_transaction_versions_unique" ON "rho_transaction_versions" USING btree ("transaction_id","version");--> statement-breakpoint
CREATE INDEX "rho_transaction_versions_txn_idx" ON "rho_transaction_versions" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rho_transactions_natural_key" ON "rho_transactions" USING btree ("connection_id","rho_transaction_id","rho_account_id");--> statement-breakpoint
CREATE INDEX "rho_transactions_posted_idx" ON "rho_transactions" USING btree ("connection_id","posted_at");--> statement-breakpoint
CREATE INDEX "rho_transactions_initiated_idx" ON "rho_transactions" USING btree ("connection_id","initiated_at");--> statement-breakpoint
CREATE INDEX "rho_transactions_movement_idx" ON "rho_transactions" USING btree ("rho_money_movement_id");--> statement-breakpoint
CREATE INDEX "rho_transactions_counterparty_idx" ON "rho_transactions" USING btree ("counterparty_name");--> statement-breakpoint
CREATE INDEX "rho_transactions_status_idx" ON "rho_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_idx" ON "sync_runs" USING btree ("connection_id","started_at");