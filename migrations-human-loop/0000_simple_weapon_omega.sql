CREATE TABLE "human_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_email" text NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"company_id" integer,
	"ticker" text,
	"summary" text NOT NULL,
	"raw_text" text,
	"subject_type" text,
	"subject_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"company_id" integer,
	"ticker" text,
	"constraint_id" uuid,
	"headline" text NOT NULL,
	"detail" text,
	"payload" jsonb NOT NULL,
	"materiality" numeric(4, 3),
	"source_url" text,
	"source_ref" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"known_at" timestamp with time zone NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "human_events_user_idx" ON "human_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "human_events_session_idx" ON "human_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "human_events_company_idx" ON "human_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "human_events_subject_idx" ON "human_events" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "world_events_dedupe_idx" ON "world_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "world_events_recent_idx" ON "world_events" USING btree ("known_at");--> statement-breakpoint
CREATE INDEX "world_events_company_idx" ON "world_events" USING btree ("company_id","known_at");--> statement-breakpoint
CREATE INDEX "world_events_kind_idx" ON "world_events" USING btree ("kind","known_at");