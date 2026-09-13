DROP INDEX "connections_label_idx";--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "owner_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connections_owner_label_idx" ON "connections" USING btree ("owner_id","label");--> statement-breakpoint
CREATE INDEX "connections_owner_idx" ON "connections" USING btree ("owner_id");