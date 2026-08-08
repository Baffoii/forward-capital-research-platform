CREATE TYPE "public"."edge_derivation" AS ENUM('customer_concentration', 'segment_disclosure', 'transcript_mention', 'trade_data', 'analyst_estimate', 'manual');--> statement-breakpoint
CREATE TYPE "public"."constraint_direction" AS ENUM('tightening', 'stable', 'easing');--> statement-breakpoint
CREATE TYPE "public"."kill_status" AS ENUM('armed', 'triggered', 'retired');--> statement-breakpoint
CREATE TABLE "capture_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"fiscal_period" text NOT NULL,
	"gross_margin_pct" numeric(6, 3),
	"backlog_value" numeric(18, 2),
	"contract_structure" text DEFAULT 'unknown' NOT NULL,
	"has_price_escalators" text,
	"utilization_pct" numeric(5, 2),
	"source_document_id" integer,
	"effective_from" timestamp with time zone NOT NULL,
	"known_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constraint_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constraint_id" uuid NOT NULL,
	"tightening" numeric(4, 3) NOT NULL,
	"direction" "constraint_direction" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"method" text NOT NULL,
	"lead_time_weeks" integer,
	"effective_from" timestamp with time zone NOT NULL,
	"known_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constraints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"fiscal_period" text NOT NULL,
	"consensus_eps" numeric(12, 4),
	"consensus_revenue" numeric(18, 2),
	"analyst_count" integer,
	"known_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exposure_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"constraint_id" uuid NOT NULL,
	"via_company_id" integer,
	"revenue_share" numeric(4, 3) NOT NULL,
	"hops" integer DEFAULT 0 NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"derivation" "edge_derivation" NOT NULL,
	"source_document_id" integer,
	"supporting_quote" text,
	"effective_from" timestamp with time zone NOT NULL,
	"known_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kill_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer,
	"constraint_id" uuid,
	"statement" text NOT NULL,
	"predicate" jsonb NOT NULL,
	"status" "kill_status" DEFAULT 'armed' NOT NULL,
	"triggered_at" timestamp with time zone,
	"triggered_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"constraint_id" uuid,
	"long_score" numeric(6, 5) NOT NULL,
	"short_score" numeric(6, 5) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"components" jsonb NOT NULL,
	"scorer_version" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"side" text NOT NULL,
	"weight_pct" numeric(6, 3) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"thesis_note" text
);
--> statement-breakpoint
CREATE TABLE "recognition_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"analyst_count" integer,
	"theme_mention_density" numeric(6, 3),
	"thematic_etf_count" integer,
	"multiple_vs_own_history" numeric(6, 3),
	"short_interest_pct" numeric(5, 2),
	"recognition" numeric(4, 3) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"known_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "constraint_states" ADD CONSTRAINT "constraint_states_constraint_id_constraints_id_fk" FOREIGN KEY ("constraint_id") REFERENCES "public"."constraints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposure_edges" ADD CONSTRAINT "exposure_edges_constraint_id_constraints_id_fk" FOREIGN KEY ("constraint_id") REFERENCES "public"."constraints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kill_criteria" ADD CONSTRAINT "kill_criteria_constraint_id_constraints_id_fk" FOREIGN KEY ("constraint_id") REFERENCES "public"."constraints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_constraint_id_constraints_id_fk" FOREIGN KEY ("constraint_id") REFERENCES "public"."constraints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_lookup_idx" ON "capture_metrics" USING btree ("company_id","known_at");--> statement-breakpoint
CREATE INDEX "constraint_states_lookup_idx" ON "constraint_states" USING btree ("constraint_id","known_at");--> statement-breakpoint
CREATE UNIQUE INDEX "constraints_slug_idx" ON "constraints" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "estimate_lookup_idx" ON "estimate_snapshots" USING btree ("company_id","fiscal_period","known_at");--> statement-breakpoint
CREATE INDEX "exposure_edges_company_idx" ON "exposure_edges" USING btree ("company_id","known_at");--> statement-breakpoint
CREATE INDEX "exposure_edges_constraint_idx" ON "exposure_edges" USING btree ("constraint_id","known_at");--> statement-breakpoint
CREATE INDEX "kill_status_idx" ON "kill_criteria" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scores_rank_idx" ON "opportunity_scores" USING btree ("as_of","long_score");--> statement-breakpoint
CREATE INDEX "scores_company_idx" ON "opportunity_scores" USING btree ("company_id","as_of");--> statement-breakpoint
CREATE INDEX "recognition_lookup_idx" ON "recognition_snapshots" USING btree ("company_id","known_at");