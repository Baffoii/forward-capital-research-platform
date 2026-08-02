CREATE TABLE "research_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"ticker" text,
	"question" text NOT NULL,
	"intended_position_pct" numeric(6, 3) DEFAULT '1' NOT NULL,
	"time_sensitivity" numeric(4, 3) DEFAULT '0.5' NOT NULL,
	"estimated_hours" numeric(5, 2) DEFAULT '2' NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"conclusion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "research_items_status_idx" ON "research_items" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "research_items_company_idx" ON "research_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "research_items_claim_idx" ON "research_items" USING btree ("claimed_by","status");