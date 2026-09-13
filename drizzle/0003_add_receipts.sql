CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"engine_version" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_slug_idx" ON "receipts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "receipts_connection_idx" ON "receipts" USING btree ("connection_id","created_at");