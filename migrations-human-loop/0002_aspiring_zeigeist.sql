CREATE TABLE "handoff_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"assignee_email" text,
	"raw_text" text NOT NULL,
	"ticker" text,
	"company_id" integer,
	"found" text,
	"still_open" text,
	"needs_decision" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structuring_status" text DEFAULT 'pending' NOT NULL,
	"followup_question" text,
	"followup_answer" text,
	"status" text DEFAULT 'open' NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"closing_note" text,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "handoff_assignee_idx" ON "handoff_packets" USING btree ("assignee_email","status");--> statement-breakpoint
CREATE INDEX "handoff_open_idx" ON "handoff_packets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "handoff_author_idx" ON "handoff_packets" USING btree ("author_id","created_at");