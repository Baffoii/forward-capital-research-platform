import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The substrate for everything a human touches.
 *
 * Two logs and nothing else:
 *
 *   world_events — what happened out there. Filings, price moves, score
 *                  changes, a company getting picked up by another analyst.
 *   human_events — what we did. Looked at something, concluded something,
 *                  opened a question, closed one, handed work to someone.
 *
 * Every human-facing feature in this app is a query over one or both. The
 * weekly digest is world_events since Sunday filtered by how much they matter.
 * The re-entry briefing is both logs since *your* last session. The research
 * queue reads human_events to know what's already been looked at. Building the
 * logs first is what stops those from being six separate features that each
 * invent their own history.
 *
 * DIALECT NOTE: pg-core, same reasoning as shared/schema.constraints.ts — the
 * live database is Supabase Postgres and the runtime query layer is PostgREST
 * via server/supabase.ts, not Drizzle. shared/schema.ts is sqlite-core and is a
 * type-generation artifact only, so it cannot share a drizzle-kit entrypoint
 * with this file. This file is pushed through drizzle.config.human-loop.ts.
 *
 * `companyId` is `integer` because the pre-existing companies table uses an
 * integer serial primary key. A uuid here would never join to a real company.
 *
 * APPEND-ONLY: both tables reject UPDATE and DELETE at the database level. See
 * the trigger at the bottom of the generated migration — a comment is not an
 * invariant, a trigger is.
 */

/**
 * The event vocabulary lives in shared/human-loop-events.ts, not here, so the
 * pure log reasoning can be tested on bare node without pulling in drizzle.
 * Re-exported so callers only need one import.
 */
export * from "./human-loop-events";

/* ------------------------------------------------------------------ */
/* world_events — what happened out there                              */
/* ------------------------------------------------------------------ */

export const worldEvents = pgTable(
  "world_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** One of WORLD_EVENT_KINDS. Not a pg enum — adding a kind should not
     *  require a migration, and an unknown kind should degrade to "show the
     *  headline" rather than break a query. */
    kind: text("kind").notNull(),

    companyId: integer("company_id"),
    /** Denormalized on purpose. See the payload note below. */
    ticker: text("ticker"),
    constraintId: uuid("constraint_id"),

    /**
     * One sentence, plain language, ready to paste straight into an email
     * without further formatting. "Vertiv filed a 10-Q" — not "10-Q".
     */
    headline: text("headline").notNull(),
    /** Optional second paragraph: the numbers, the quote, the specifics. */
    detail: text("detail"),

    /**
     * Everything needed to reconstruct this event WITHOUT joining to any
     * mutable table. If a company gets renamed or a score row gets superseded,
     * a two-year-old event must still read correctly. That redundancy is the
     * point of a log.
     */
    payload: jsonb("payload").notNull(),

    /**
     * 0..1, how much this matters to our thesis — not how big it is in the
     * abstract. A CFO change at a name we don't own is near zero. This is what
     * the weekly digest ranks on and what stops the digest being "everything
     * that changed". Null means nobody has judged it yet.
     */
    materiality: numeric("materiality", { precision: 4, scale: 3 }),

    /** Where to go read the actual thing. Goes in the notification. */
    sourceUrl: text("source_url"),
    /** Provenance inside our own data, e.g. "signal:412", "score:<uuid>". */
    sourceRef: text("source_ref"),

    /** When it happened out there. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** Earliest moment we could have known. Same distinction as the scoring
     *  tables: filtering a backtest on occurredAt is lookahead bias. */
    knownAt: timestamp("known_at", { withTimezone: true }).notNull(),

    /**
     * Idempotency. The daily jobs run on a cron that retries, and the backfill
     * will be run more than once. Without this, a retry silently doubles the
     * digest. Format: "<source>:<stable id>".
     */
    dedupeKey: text("dedupe_key").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupeIdx: uniqueIndex("world_events_dedupe_idx").on(t.dedupeKey),
    // The digest query: "since last Sunday, most material first".
    recentIdx: index("world_events_recent_idx").on(t.knownAt),
    companyIdx: index("world_events_company_idx").on(t.companyId, t.knownAt),
    kindIdx: index("world_events_kind_idx").on(t.kind, t.knownAt),
  }),
);

/* ------------------------------------------------------------------ */
/* human_events — what we did                                          */
/* ------------------------------------------------------------------ */

export const humanEvents = pgTable(
  "human_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Supabase auth uid. Every row has one — that is the whole point. */
    userId: uuid("user_id").notNull(),
    /**
     * Denormalized email. Supabase's auth.users table is not ours to join
     * against from PostgREST, and a log that can't say who did something
     * without a working join isn't a log.
     */
    userEmail: text("user_email").notNull(),

    /**
     * Groups a run of activity. Two events belong to the same session if they
     * are less than SESSION_GAP_MINUTES apart. This is what makes "what's
     * changed since you last looked" answerable — "since you last looked"
     * means "since the end of your previous session", not "since your last
     * click".
     */
    sessionId: uuid("session_id").notNull(),

    /** One of HUMAN_EVENT_KINDS. */
    kind: text("kind").notNull(),

    companyId: integer("company_id"),
    ticker: text("ticker"),

    /** Plain-language sentence, self-contained. */
    summary: text("summary").notNull(),

    /**
     * The text the person actually typed, kept verbatim whenever a structured
     * record was derived from it. Invariant across this whole codebase: the
     * derived version can be wrong, the raw version can't.
     */
    rawText: text("raw_text"),

    /**
     * What this event is about, without a foreign key into a mutable table.
     * subjectType: handoff_packet | journal_entry | research_item | company |
     *              digest_item | precommitment | question
     */
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),

    payload: jsonb("payload").notNull().default({}),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // "everything this person did, newest first" — the session and briefing
    // queries both start here.
    userIdx: index("human_events_user_idx").on(t.userId, t.occurredAt),
    sessionIdx: index("human_events_session_idx").on(t.sessionId),
    // "has anyone looked at this company recently" — research ranking.
    companyIdx: index("human_events_company_idx").on(t.companyId, t.occurredAt),
    // Resolving open items pairs openers with closers by subject.
    subjectIdx: index("human_events_subject_idx").on(t.subjectType, t.subjectId),
  }),
);
