CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"items" jsonb NOT NULL,
	"suppressed" integer DEFAULT 0 NOT NULL,
	"suppressed_summary" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "digests_dedupe_idx" ON "digests" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "digests_week_idx" ON "digests" USING btree ("week_start");