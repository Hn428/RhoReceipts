CREATE TABLE "receipt_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"transport" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_shares" ADD CONSTRAINT "receipt_shares_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_shares" ADD CONSTRAINT "receipt_shares_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_shares" ADD CONSTRAINT "receipt_shares_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_shares_unique" ON "receipt_shares" USING btree ("receipt_id","email");--> statement-breakpoint
CREATE INDEX "receipt_shares_email_idx" ON "receipt_shares" USING btree ("email","created_at");