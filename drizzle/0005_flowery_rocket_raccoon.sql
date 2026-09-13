CREATE TABLE "customer_research_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_research_cache" ADD CONSTRAINT "customer_research_cache_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;