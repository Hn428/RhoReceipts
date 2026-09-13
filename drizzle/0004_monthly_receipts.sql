CREATE TABLE "investor_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"period_key" text NOT NULL,
	"company_name" text NOT NULL,
	"receipt_slug" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"engine_version" text NOT NULL,
	"trigger" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"transport" text NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investor_recipients" ADD CONSTRAINT "investor_recipients_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_recipients" ADD CONSTRAINT "investor_recipients_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_report_id_monthly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."monthly_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "investor_recipients_unique" ON "investor_recipients" USING btree ("connection_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_reports_slug_idx" ON "monthly_reports" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_reports_period_idx" ON "monthly_reports" USING btree ("connection_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "report_deliveries_unique" ON "report_deliveries" USING btree ("report_id","email");