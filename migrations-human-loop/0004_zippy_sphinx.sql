CREATE TABLE "precommitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"ticker" text,
	"author_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"condition_text" text NOT NULL,
	"action_text" text NOT NULL,
	"reasoning" text NOT NULL,
	"predicate" jsonb NOT NULL,
	"status" text DEFAULT 'armed' NOT NULL,
	"met_at" timestamp with time zone,
	"met_context" jsonb,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"outcome" text,
	"outcome_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "precommitments_armed_idx" ON "precommitments" USING btree ("status","company_id");--> statement-breakpoint
CREATE INDEX "precommitments_company_idx" ON "precommitments" USING btree ("company_id","created_at");