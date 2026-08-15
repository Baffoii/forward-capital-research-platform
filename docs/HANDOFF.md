# Handoff — forward-capital-research-platform

Paste this into a fresh session to pick up. Read the STOP section first.

---

## STOP — things that look unfinished and are not

A fresh agent will want to "fix" these. Every one of them is deliberate, and
filling them in is worse than leaving them empty.

1. **`SEGMENT_CONSTRAINT_MAP` is an empty array.** Do NOT populate it. It holds
   the share of a business segment's end demand riding on a bottleneck — a
   number no filing contains, which is analyst judgement and the single largest
   error source in the whole model. Wrong by 3x and every downstream score is
   wrong by 3x with no symptom anywhere. An empty map means zero exposure edges,
   which correctly says "the attribution work has not been done" rather than
   "no exposure exists". Only the humans fill this.

2. **Every dashboard is empty.** That follows from (1). Do not seed demo rows to
   make a view render. `server/scoring/segment-constraint-map.ts` explains why
   at length; the same rule is stated in the phase-2 spec as "empty states are
   correct".

3. **Email, Discord and the LLM structuring call are all written but inert.**
   Each activates on an env var. That is the intended state, not an incomplete
   feature. See `server/watcher/dispatch.ts`, `server/watcher/notifier.ts`,
   `server/handoffs/structure.ts`.

4. **`npm run check` fails with one error** at `server/routes.ts:522`
   (`submittedAt` not in `insertResearchInboxItemSchema`). PRE-EXISTING on clean
   `main`; confirmed by two independent sessions via stash. Worth fixing, but it
   is not something you broke.

5. **Confidence is never multiplied into a score.** It is reported alongside.
   A low-confidence high score is a research task; a high-confidence low score
   is a pass. Multiplying makes those indistinguishable. Do not "simplify" this.

---

## What this is

Investment research tool for a three-person fund. Three CS students,
part-time, never simultaneously available, none of them trained finance
professionals — **use plain language in all UI copy and comments**.

Thesis: the physical bottlenecks behind the AI buildout — transformers,
switchgear, cooling, grid interconnect — NOT the model or software layer.

Two halves, both complete and merged onto one branch:

- **Phase 1, the scoring engine.** Which companies have real economic exposure
  to a tightening bottleneck the market has not priced.
- **Phase 2, the human loop.** Making sure a person actually looks — because
  the bottleneck is attention, not analysis. A board you have to remember to
  open loses to a digest that arrives.

Stack: Express + Vite + React + Tailwind + shadcn/ui, TypeScript, Supabase
Postgres. **The runtime query layer is PostgREST via `server/supabase.ts`, NOT
Drizzle** — Drizzle is schema and type generation only.

---

## Where things stand

```
branch          maas/human-loop   (has main merged in; main has screening merged in)
commits         27 unpushed
tests           20 files, 556 assertions, all passing
typecheck       1 error, pre-existing (see STOP #4)
worktrees       /Users/.../forward-research              [screening]  ← redundant
                /Users/.../forward-research-human-loop   [maas/human-loop]
```

`screening` is fully merged into `main` and has nothing unique. It is still
checked out in a live worktree. **Retire it after pushing** — leaving it alive
is how two sessions once diverged by ~5,000 lines each without noticing.

Database row counts as of the last successful check:

```
companies 13, constraints 14, signals 71, capture_metrics 85,
world_events 71, human_events 3
exposure_edges 0, opportunity_scores 0, constraint_states 0,
recognition_snapshots 0, positions 0
```

The zeros are all downstream of STOP #1.

**The Supabase project may be paused.** Free-tier projects pause after ~7 days
idle. Symptom is `TypeError: fetch failed` on every table. Resume it from the
dashboard.

---

## The scoring model

```
long  = exposure x max(0, tightening) x (1 - recognition) x divergence x capture
short = exposure x max(0, -tightening) x recognition      x divergence x capture
```

Multiplication, not addition — any dead term collapses the score, which is
correct. A real shortage at a company that cannot reprice is worth nothing.

Scored per **(company, constraint) pair**, never per ticker. One company can be
compelling on one bottleneck and irrelevant on another.

---

## Invariants — do not violate

1. **`knownAt` != `effectiveFrom`.** `effectiveFrom` is when a fact became true;
   `knownAt` is the earliest we could have known it. Every read feeding scoring
   goes through `asKnownAt()`. Filtering on `effectiveFrom` is lookahead bias
   and silently invalidates every backtest.
2. **`world_events` and `human_events` are append-only, enforced by a database
   trigger** (`migrations-human-loop/append-only.sql`). Correct a mistake by
   appending a correcting row. There is no update or delete function in
   `server/human-loop/store.ts` and there must never be one.
3. **Scores and constraint states are append-only.** Always stamp
   `scorerVersion`.
4. **Confidence is never folded into the score.** See STOP #5.
5. **No automated trade execution or export, ever.** No broker integration, no
   order file, no CSV of positions to act on. The system notifies; a human
   executes elsewhere. Every notification says so explicitly, and
   `server/watcher/compose.test.ts` asserts it.
6. **Every derived number keeps its source** — endpoint or `sourceDocumentId`,
   plus the quote and a fetch timestamp.
7. **Metrics are team-level, never per-person.** This system logs the team's own
   behaviour, and a per-person scorecard makes people log dishonestly — which
   would corrupt the research queue, since it ranks on those same logs. There is
   deliberately no endpoint that produces a per-person breakdown.
8. **Plain language everywhere a human reads.** "Money owed under signed
   contracts not yet delivered" beats "RPO".

---

## Layout

```
server/scoring/       the engine: exposure, opportunity, tightening,
                      recognition, estimates, runner, backtest, cli
server/ingestion/     SEC EDGAR: filings, extraction, exposure graph
server/transcripts/   paste seam + lead-time extractor
server/human-loop/    the two logs, log queries, backfill
server/watcher/       predicate engine, context, compose, dispatch, notifier
server/handoffs/      packets, optional LLM structuring
server/journal/       decision journal + resurfacing rules
server/precommitments/  conditions decided in advance
server/digest/        materiality ranking, render, build
server/briefing/      re-entry assembly
server/research/      value-of-information ranking
server/fmp/           the single FMP client
server/prices/        PriceSource interface + FMP/null adapters
```

Pure logic is separated from I/O throughout so it can be unit tested on bare
node with no framework. `scripts/run-tests.mjs` walks for `*.test.ts` and runs
each with `--experimental-strip-types`. **That runner does no path-alias
resolution**, so any module reachable from a test must use relative imports with
an explicit `.ts` extension.

---

## Commands

```bash
npm test                     # 20 files, 556 assertions
npm run check                # tsc — 1 pre-existing failure, see STOP #4
npm run dev                  # PORT=5001 is in .env; see gotchas
npm run seed:constraints     # idempotent by slug
npm run pipeline             # full ingest, SEC rate-limited
npm run score [YYYY-MM-DD]   # score at a point in time
npm run backtest             # monthly replay + pearson collinearity check
```

Admin endpoints are behind the `x-admin-token` header; human endpoints behind
Supabase Google auth restricted to three hardcoded emails in `shared/team.ts`.

---

## Gotchas that cost hours

- **macOS AirPlay Receiver owns port 5000.** Returns 403 with an empty body and
  an empty server log, which looks exactly like an auth failure. `.env` sets
  `PORT=5001`.
- **`reusePort: true` throws `ENOTSUP` on macOS**, on every port. Fixed in
  `server/index.ts` with a platform guard; kept for other platforms.
- **FMP free tier is a symbol whitelist, not just endpoint gating.** Probed
  live: `NVDA AMZN MSFT AMD INTC` work; `GOOG SNDK MU AVGO MRVL VRT BE GEV` are
  refused with `Premium Query Parameter`. VRT and GEV are the only two names in
  the universe that touch the equipment tier, and both are blocked. Transcripts,
  `etf/asset-exposure` and `eod-bulk` are blocked outright. Full detail in the
  header of `server/fmp/client.ts`. **Do not spend time rediscovering this.**
- **PostgREST returns `numeric` as a string.** Hydrate on the way out or you
  will compare `"2100000000"` to `2.1e9` as strings.
- **The universe is arguably wrong for the thesis.** Ten of thirteen companies
  are semis and hyperscalers — the layer the thesis says it is NOT betting on.
  Flagged by phase 1, deliberately not acted on. Names that would exercise the
  registry: Eaton, Hubbell, Powell, nVent, Hammond Power, Quanta, MYR, IES,
  Comfort Systems, Modine, Munters, Cleveland-Cliffs.

---

## Open work

**Blocked on the humans:**

1. Fill `SEGMENT_CONSTRAINT_MAP` — 3–4 rows. Best candidates from the last
   pipeline run: GEV/"Power", NVDA/"Networking", MU/"CMBU", maybe INTC/"Intel
   Foundry". Each needs `endDemandShare`, `confidence` and a `basis` you would
   defend out loud. **Nothing scores until this exists.**
2. Push 27 commits, then set GitHub secrets `APP_BASE_URL` and
   `INGEST_ADMIN_TOKEN`, and add the production URL to Supabase Site URL.
3. Rotate the Supabase personal access token — one with DDL rights was used
   from an agent session.
4. Retire the `screening` branch and its worktree, after pushing.

**Available to an agent:**

5. Fix the `submittedAt` type error so `npm run check` can gate CI.
6. Add a commented worked example to `segment-constraint-map.ts` so filling it
   is copy-and-edit. **A commented example only — do not add live entries.**
7. Optional: pull project-tracker status into the weekly digest, so the digest
   stays the only thing anyone has to read.

**Deferred by the operator, do not start without asking:**

- Row-level security plus a service-role key. The anon key is in the browser
  bundle and currently bypasses the auth middleware. Real, and deliberately
  parked.
- Email provider, Discord webhook URLs, `ANTHROPIC_API_KEY`.
- Fixing the universe.

---

## Secrets

`.env` is gitignored and holds the Supabase URL and anon key, the admin token,
`PORT`, and the FMP key. It is not in the repo — the operator must supply it.
`.env.example` documents every variable and what happens when each is unset.
