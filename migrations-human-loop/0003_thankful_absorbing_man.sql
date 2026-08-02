CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"ticker" text,
	"position_id" uuid,
	"author_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"belief" text NOT NULL,
	"expectation" text NOT NULL,
	"expect_by" timestamp with time zone,
	"falsifier" text NOT NULL,
	"raw_text" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reviewer_email" text NOT NULL,
	"trigger_kind" text NOT NULL,
	"trigger_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"still_agree" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_reviews" ADD CONSTRAINT "journal_reviews_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_company_idx" ON "journal_entries" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "journal_due_idx" ON "journal_entries" USING btree ("status","expect_by");--> statement-breakpoint
CREATE INDEX "journal_reviews_entry_idx" ON "journal_reviews" USING btree ("entry_id","created_at");