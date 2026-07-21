# Forward Capital Research Platform

A thesis-driven investment research workspace. Unlike a stock-tipping tool, Forward Capital is built around a single question for every thesis: **what evidence would prove me wrong?**

Live demo: [forward-capital.pplx.app](https://forward-capital.pplx.app)

## What it does

- **Thesis workspace** — write and track an investment thesis (e.g. "AI infrastructure supply-chain bottleneck") tied to a watchlist of companies.
- **Evidence board** — every signal (quote data, insider transactions, analyst research, SEC filings, patents) is tagged as confirming or contradicting the thesis. The contradicting side is **not dismissible** — it stays visible by design, so the tool can't be used to just build a bull case.
- **Signal feed & confidence score** — signals are scored on relevance, reliability, novelty, and independent confirmation, and rolled up into a single thesis confidence gauge.
- **Research inbox** — manual-entry only. No bots, no auto-scraping of third-party platforms outside licensed/public APIs.
- **Source management & audit trail** — every signal keeps its source URL, retrieval timestamp, and an "unverified" label where verification tier is low, so provenance is never lost.
- **Human-in-the-loop only** — the platform never executes or exports trades. There is no automated trading path in this codebase.

## Data sources

All ingestion uses public, licensed, or user-owned data:

- **SEC EDGAR** (public filings API) — live, direct integration.
- **USPTO PatentsView** (public patents API) — live, direct integration.
- **Perplexity Finance connector** (quotes, insider transactions, analyst research) — requires access to Perplexity's finance tools; see below for how this is fetched outside the app itself.

## Architecture

- **Frontend/backend**: Express + Vite + React + Tailwind + shadcn/ui, TypeScript throughout.
- **Database**: Supabase (Postgres). Drizzle ORM for schema and queries (`shared/schema.ts`, `server/storage.ts`).
- **Ingestion**: `server/ingestion/` — SEC EDGAR and PatentsView clients call their public APIs directly from the server. Finance-connector data (quotes/insiders/analyst research) is fetched by an external script (see `scripts/daily_sync.py`) because that connector is only reachable from inside a Perplexity agent session, not from arbitrary server code, and pushed into the app over HTTPS via `/api/admin/ingest`.
- **Admin routes** (`/api/admin/*`): protected by a shared-secret `x-admin-token` header, used for ingest, per-company EDGAR refresh (`/api/companies/:id/sync/filings`), and thesis confidence recompute (`/api/admin/recompute-all`). A combined `/api/admin/sync-all` also exists for manual/UI use, but the recurring sync script deliberately calls the smaller, per-company/per-step endpoints instead — doing all 13 companies' work in one request proved unstable under sustained load in this app's serverless deployment target, and splitting it into many small requests fixed that.

## Getting started

```bash
git clone https://github.com/Baffoii/forward-capital-research-platform.git
cd forward-capital-research-platform
npm install
cp .env.example .env   # fill in your own Supabase project + admin token
npm run dev
```

The dev server runs Express + Vite together on one port (default from `server/index.ts`).

### Environment variables

See `.env.example`. You'll need:

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — create a free project at [supabase.com](https://supabase.com), then run the schema migration (see `scripts/gen_migration_sql.py` / `shared/schema.ts` with `npm run db:push`).
- `INGEST_ADMIN_TOKEN` — any random string you choose; required in the `x-admin-token` header for all `/api/admin/*` routes.

### Refreshing data

- SEC EDGAR filings and patent data can be synced live from the UI (no extra credentials needed — both are public APIs).
- Quote/insider/analyst-research signals require Perplexity's finance connector, which is only callable from within a Perplexity agent session. `scripts/daily_sync.py` shows the intended pattern: fetch via the connector, then push into your own running instance's `/api/admin/ingest` endpoint over HTTPS. If you don't have access to that connector, you can adapt the same ingest endpoint to push data from any financial data API you have access to — the endpoint just expects `{companyId, ticker, type, result}` items.

### Build & deploy

```bash
npm run build
npm start
```

Deployable anywhere that runs a Node process (the build output is a single `dist/index.cjs` plus static assets in `dist/public`).

## Compliance notes (please preserve if you fork this)

This project was built under explicit constraints that are core to its design, not incidental:

- No material non-public information, no improperly obtained proprietary data, no violation of any platform's terms of service or rate limits.
- The contradiction/evidence-against-thesis panel must remain non-dismissible.
- Unverified information must stay labeled as such; source attribution and audit trail must be preserved for every signal.
- No automated trade execution or export — human approval is required for any real-world action taken on this research.
- No bots or self-botting against third-party platforms; the Research Inbox is manual-entry only.

If you fork this for your own use, please keep these guardrails — they're what keeps this a research tool instead of a source of bad advice or compliance risk.

## License

MIT — see `LICENSE`.
