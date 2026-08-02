import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
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

/* ------------------------------------------------------------------ */
/* watcher_rules — what we've asked to be told about                   */
/* ------------------------------------------------------------------ */

/**
 * A rule is a stored JSON predicate plus who to tell and how often to check.
 *
 * Stored rather than coded so a rule can be written, read back and argued with
 * without a deploy. The language and its three-valued evaluation live in
 * server/watcher/predicate.ts.
 */
export const watcherRules = pgTable(
  "watcher_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    /** Short name, shown in the notification subject. */
    name: text("name").notNull(),
    /**
     * Plain language, written by whoever made the rule: what this is watching
     * for and why we care. This text goes into the notification, which is how
     * a notification manages to be actionable without opening the app.
     */
    description: text("description"),

    /** What kind of notification this produces. See NOTIFICATION_KINDS. */
    kind: text("kind").notNull(),
    /** immediate | daily | weekly */
    cadence: text("cadence").notNull(),

    predicate: jsonb("predicate").notNull(),

    /** Team emails. Empty list means everyone. */
    recipients: jsonb("recipients").notNull().default([]),

    /**
     * Which company this rule is about, or null for rules that apply to every
     * company we follow.
     */
    companyId: integer("company_id"),

    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("watcher_rules_slug_idx").on(t.slug),
    activeIdx: index("watcher_rules_active_idx").on(t.enabled, t.cadence),
  }),
);

/* ------------------------------------------------------------------ */
/* notifications — the thing that actually reaches a person            */
/* ------------------------------------------------------------------ */

/**
 * Not a log — this table tracks delivery, so sentAt and clickedAt are updated
 * in place. The two logs are the append-only ones.
 *
 * `body` must be complete on its own. A notification that says "3 things need
 * your attention, log in to see them" is a dashboard with extra steps, and a
 * dashboard you have to remember to open is the exact thing this phase exists
 * to escape.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    ruleId: uuid("rule_id"),

    recipientEmail: text("recipient_email").notNull(),
    subject: text("subject").notNull(),
    /** Plain text, self-contained, plain language. */
    body: text("body").notNull(),

    /** Structured copy of everything in the body, for the UI and for tuning. */
    payload: jsonb("payload").notNull().default({}),

    companyId: integer("company_id"),
    ticker: text("ticker"),

    /**
     * Idempotency across cron retries. Format
     * "<rule slug>:<what triggered it>". Without it a retried job emails the
     * same alert twice and the team learns to ignore the channel.
     */
    dedupeKey: text("dedupe_key").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sendAttempts: integer("send_attempts").notNull().default(0),
    sendError: text("send_error"),
    /** Set when someone follows a link from the notification. Feeds digest tuning. */
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
  },
  (t) => ({
    dedupeIdx: uniqueIndex("notifications_dedupe_idx").on(t.dedupeKey),
    // The dispatch job's query: "what hasn't gone out yet".
    pendingIdx: index("notifications_pending_idx").on(t.sentAt, t.createdAt),
    recipientIdx: index("notifications_recipient_idx").on(
      t.recipientEmail,
      t.createdAt,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/* handoff_packets — handing work to a teammate without dropping it    */
/* ------------------------------------------------------------------ */

/**
 * The failure this table exists to prevent is silent dropped work: three
 * part-time people, never online at the same time, each assuming someone else
 * has it.
 *
 * `rawText` is the only field guaranteed to be filled in. The input is ONE
 * textarea that accepts whatever was in someone's head, typed between classes
 * on a phone. Everything below it is derived afterwards and is editable,
 * because the derivation will sometimes be wrong. A form with eight labelled
 * fields would not get filled in and the team would go back to texting.
 */
export const handoffPackets = pgTable(
  "handoff_packets",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    authorId: uuid("author_id").notNull(),
    authorEmail: text("author_email").notNull(),
    /** Who it's for. Null means "somebody pick this up". */
    assigneeEmail: text("assignee_email"),

    /** Exactly what the person typed. Never overwritten, never derived from. */
    rawText: text("raw_text").notNull(),

    /* -- Derived, editable. Null until structuring runs (or never). -- */
    ticker: text("ticker"),
    companyId: integer("company_id"),
    /** What I found. */
    found: text("found"),
    /** What's still open. */
    stillOpen: text("still_open"),
    /** What you need to decide. */
    needsDecision: text("needs_decision"),
    /** Links, filings, page numbers — whatever was cited. */
    sources: jsonb("sources").notNull().default([]),

    /** pending | structured | unavailable | edited | skipped */
    structuringStatus: text("structuring_status").notNull().default("pending"),
    /**
     * At most ONE follow-up question, asked only when something essential is
     * missing. Eight questions is a form, and a form is what we're avoiding.
     */
    followupQuestion: text("followup_question"),
    followupAnswer: text("followup_answer"),

    /** open | accepted | closed */
    status: text("status").notNull().default("open"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
    closingNote: text("closing_note"),

    /**
     * Set when the 48-hour reminder went out, so it goes out once rather than
     * every time the scheduled job runs.
     */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // "what's waiting on me" and "what hasn't been picked up yet".
    assigneeIdx: index("handoff_assignee_idx").on(t.assigneeEmail, t.status),
    openIdx: index("handoff_open_idx").on(t.status, t.createdAt),
    authorIdx: index("handoff_author_idx").on(t.authorId, t.createdAt),
  }),
);

/** How long an unaccepted packet sits before everyone gets told about it. */
export const HANDOFF_ESCALATION_HOURS = 48;
