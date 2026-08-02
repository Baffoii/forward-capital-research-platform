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

/* ------------------------------------------------------------------ */
/* journal_entries — the reasoning, written at the time                */
/* ------------------------------------------------------------------ */

/**
 * Why we did this, written when we did it.
 *
 * A normal form is right here, unlike handoffs: this is written at a desk when
 * a position goes on, not typed one-handed between classes, and the three
 * fields are exactly the three things that are worth arguing with later.
 *
 * Nothing in this table is ever edited. The whole value of the record is that
 * it says what you thought then, not what you'd like to have thought. Changing
 * your mind means writing a review (below), which is a separate row.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id").notNull(),
    ticker: text("ticker"),
    /** Optional link to a row in `positions`. */
    positionId: uuid("position_id"),

    authorId: uuid("author_id").notNull(),
    authorEmail: text("author_email").notNull(),

    /** What we believe. */
    belief: text("belief").notNull(),
    /** What we expect, and by when. */
    expectation: text("expectation").notNull(),
    expectBy: timestamp("expect_by", { withTimezone: true }),
    /** What would change our mind. The field people skip and later wish they hadn't. */
    falsifier: text("falsifier").notNull(),

    /** If this was written from a longer note, keep the note. */
    rawText: text("raw_text"),

    /** open | closed — closed when the position is exited. */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index("journal_company_idx").on(t.companyId, t.createdAt),
    dueIdx: index("journal_due_idx").on(t.status, t.expectBy),
  }),
);

/* ------------------------------------------------------------------ */
/* journal_reviews — the calibration record                            */
/* ------------------------------------------------------------------ */

/**
 * Whether the author still agrees with themselves, and why not if not.
 *
 * This is the dataset that eventually says something useful about how this
 * team thinks: not whether the trades worked, but whether the reasoning held
 * up, and which kinds of reasoning stop holding up first.
 *
 * Append-only in spirit and in practice — a second look is a second row. The
 * trigger payload is stored alongside so a future reading knows what was
 * happening at the moment the question was asked.
 */
export const journalReviews = pgTable(
  "journal_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),

    reviewerId: uuid("reviewer_id").notNull(),
    reviewerEmail: text("reviewer_email").notNull(),

    /** earnings | kill_criterion_near | price_move | expectation_due | scheduled | manual */
    triggerKind: text("trigger_kind").notNull(),
    /** What had happened, captured at the moment we asked. */
    triggerPayload: jsonb("trigger_payload").notNull().default({}),

    /** yes | no | partly — the calibration signal. */
    stillAgree: text("still_agree").notNull(),
    /** What changed, in their words. */
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    entryIdx: index("journal_reviews_entry_idx").on(t.entryId, t.createdAt),
  }),
);

/* ------------------------------------------------------------------ */
/* precommitments — decided in advance, executed by a human            */
/* ------------------------------------------------------------------ */

/**
 * "If backlog comes in below $2.1bn, trim 30%."
 *
 * The value is entirely in the fact that it was decided when calm. By the time
 * the condition is met you are looking at a red number and will reason your way
 * out of it, so the notification carries the decision AND the reasoning
 * verbatim — not a link to them.
 *
 * ── HARD CONSTRAINT ──────────────────────────────────────────────────────
 * NOTHING IN THIS SYSTEM PLACES OR EXPORTS A TRADE. Not here, not anywhere in
 * this repo. When a condition is met the system sends a message and stops. A
 * human decides, and executes in their own brokerage. There is deliberately no
 * broker integration, no order file, no CSV export of positions to act on, and
 * no field on this table that could hold one. See the compliance notes in
 * README.md — this is core to the design, not incidental.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const precommitments = pgTable(
  "precommitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id").notNull(),
    ticker: text("ticker"),

    authorId: uuid("author_id").notNull(),
    authorEmail: text("author_email").notNull(),

    /** The condition in the author's own words. Goes in the notification. */
    conditionText: text("condition_text").notNull(),
    /** What they decided to do about it. Also verbatim. */
    actionText: text("action_text").notNull(),
    /** Why — written while calm, which is the whole point. */
    reasoning: text("reasoning").notNull(),

    /** Machine-checkable form of conditionText. Same language as watcher rules. */
    predicate: jsonb("predicate").notNull(),

    /** armed | met | retired */
    status: text("status").notNull().default("armed"),
    metAt: timestamp("met_at", { withTimezone: true }),
    /** The numbers at the moment it was met, so the record stands alone later. */
    metContext: jsonb("met_context"),

    /**
     * What the human actually did. Not "did the system execute" — it never
     * does — but "did you follow through, and if not, why not". That gap is
     * the most interesting thing this table records.
     */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),
    /** followed | ignored | changed_mind */
    outcome: text("outcome"),
    outcomeNote: text("outcome_note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    armedIdx: index("precommitments_armed_idx").on(t.status, t.companyId),
    companyIdx: index("precommitments_company_idx").on(t.companyId, t.createdAt),
  }),
);

/* ------------------------------------------------------------------ */
/* digests — five things, and what got cut                             */
/* ------------------------------------------------------------------ */

/**
 * One row per week. Kept rather than regenerated because the interesting
 * question later is not "what mattered this week" but "what did we think
 * mattered, and were we right" — and that only works if the ranking is
 * preserved with its reasoning at the time.
 *
 * `suppressed` is stored deliberately. A digest that silently drops things
 * reads as "nothing else happened", which is a lie; recording the count is
 * what lets someone later ask whether the cap is set right.
 */
export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Sunday 00:00 UTC of the week covered. */
    weekStart: timestamp("week_start", { withTimezone: true }).notNull(),

    /** The five, each with its materiality and the reasons behind it. */
    items: jsonb("items").notNull(),
    suppressed: integer("suppressed").notNull().default(0),
    suppressedSummary: text("suppressed_summary"),

    /** One digest per week, even if the Sunday cron retries. */
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupeIdx: uniqueIndex("digests_dedupe_idx").on(t.dedupeKey),
    weekIdx: index("digests_week_idx").on(t.weekStart),
  }),
);

/* ------------------------------------------------------------------ */
/* research_items — where an hour would change a decision              */
/* ------------------------------------------------------------------ */

/**
 * A specific question an hour of work would answer.
 *
 * Not "look at Vertiv" — "find out whether Vertiv's long-term contracts have
 * price escalators". The queue ranks by value of information, and a vague item
 * can't be estimated, can't be finished, and can't be told apart from the
 * general anxiety of not having read enough.
 *
 * The claim fields are the reason this table exists at all rather than being
 * derived: two people, three time zones of availability, one Saturday, and no
 * way to tell whether the other has already started.
 */
export const researchItems = pgTable(
  "research_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id").notNull(),
    ticker: text("ticker"),

    /** The question. Specific enough to be finished. */
    question: text("question").notNull(),

    /** How big we'd go if this resolves well, as % of the book. */
    intendedPositionPct: numeric("intended_position_pct", { precision: 6, scale: 3 })
      .notNull()
      .default("1"),
    /** 0..1 — does the answer decay if we wait. Earnings next week is a 1. */
    timeSensitivity: numeric("time_sensitivity", { precision: 4, scale: 3 })
      .notNull()
      .default("0.5"),
    estimatedHours: numeric("estimated_hours", { precision: 5, scale: 2 })
      .notNull()
      .default("2"),

    createdBy: text("created_by").notNull(),

    /**
     * open | claimed | done | not_worth_more_time
     *
     * `not_worth_more_time` is a first-class terminal state sitting alongside
     * `done`, not a form of abandonment. Deciding a name isn't worth another
     * hour takes it off everyone's list, which is a real result — and the
     * queue reads these logs, so a system that only recorded activity would
     * produce activity.
     */
    status: text("status").notNull().default("open"),

    /** Who currently has it. Null means free. */
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
    /** What they found, or why it wasn't worth more time. */
    conclusion: text("conclusion"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("research_items_status_idx").on(t.status, t.createdAt),
    companyIdx: index("research_items_company_idx").on(t.companyId),
    claimIdx: index("research_items_claim_idx").on(t.claimedBy, t.status),
  }),
);
