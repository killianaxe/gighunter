# Gighunter Architecture

**Author:** Michael Cumberland

This document describes how the Gighunter server is structured, how data flows through the system, and the design decisions behind key components.

## System context

Gighunter is a **local-first, single-user** job search agent. It runs on your machine, stores data in SQLite, and serves a web dashboard from the same process. An optional `auto/` layer adds MCP tools and scheduled auto-drafting for agent-driven workflows.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (public/)                       │
│              Dashboard UI  ←→  REST API  (/api/*)               │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                    Fastify Server (server/index.ts)               │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Routes  │  │ Scheduler  │  │ Pipeline │  │  Connectors   │  │
│  └────┬─────┘  └─────┬──────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │              │                 │          │
│       └──────────────┴──────────────┴─────────────────┘          │
│                              │                                    │
│                    ┌─────────▼─────────┐                          │
│                    │  SQLite (WAL)     │                          │
│                    │  server/data/     │                          │
│                    └───────────────────┘                          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
   Remotive API            Himalayas API           Adzuna / USAJOBS
   RSS feeds               (public)                (API keys)
        │                       │                       │
        └───────────────────────┴───────────────────────┘

Optional:
┌──────────────────┐     HTTP      ┌──────────────────┐
│  auto/ MCP       │ ────────────→ │  Gighunter API   │
│  auto/ scheduler │               │  (same server)   │
└──────────────────┘               └──────────────────┘
        │
   Claude Code / Desktop (MCP tools)
```

## Core modules

### Entry and configuration

| Module | Role |
|--------|------|
| `index.ts` | Fastify bootstrap, CORS, static files, route registration, scheduler start |
| `env.ts` | Parses `server/.env` into `process.env` (does not overwrite existing vars) |
| `scheduler.ts` | 60-second interval loop for due source polling + Telegram notify |

### Database layer (`db/`)

SQLite with WAL journaling and foreign keys enabled. Schema defined in `schema.sql`; incremental migrations in `migrate.ts` handle existing databases.

**Tables:**

| Table | Purpose |
|-------|---------|
| `candidates` | Single user profile (skills, salary, locations, resume data) |
| `sources` | Job feed configurations (type, query/URL, poll cadence) |
| `jobs` | Normalized listings, deduped by `normalized_key` |
| `matches` | Job ↔ candidate scores and rationale |
| `applications` | Draft/approved application materials per job |
| `audit_log` | Append-only action history |
| `app_settings` | Key/value agent tuning (notifications, scoring targets) |

**Design notes:**

- `jobs.notified_at` lives on jobs, not matches, so rescoring does not re-trigger Telegram announcements
- `applications.tailoring_json` stores the full LLM tailoring result (gaps, fit assessment, etc.)
- Phase 1 uses `DEFAULT_USER_ID` — no multi-tenant auth

### Connectors (`connectors/`)

Each connector implements:

```typescript
(queryOrUrl: string) => Promise<NormalizedListing[]>
```

All connectors return a common `NormalizedListing` shape (title, company, location, description, url, salary range, posted date, external ID). The poll pipeline does not need to know source-specific details.

**Supported sources:**

- **remotive** — Public JSON API, remote-only board
- **himalayas** — Public search API, remote-focused
- **adzuna** — Requires `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`
- **usajobs** — Requires `USAJOBS_API_KEY` + email User-Agent
- **rss** — Generic feed parser; `query_or_url` is the feed URL

Capabilities metadata (`capabilities.ts`) documents what each source provides (full JD, salary, remote filter, etc.) for the UI and agents.

### Pipeline (`pipeline/`)

| Stage | Module | Description |
|-------|--------|-------------|
| Poll | `poll.ts` | Iterates sources, calls connectors, inserts new jobs |
| Normalize | `normalize.ts` | Builds dedupe key from title + company |
| Match | `match.ts` | Scores jobs, handles exclusions, skill families |
| Draft | `draft.ts` | Rule-based headline/summary/bullet selection |
| Resume | `resume.ts` | Full ATS-friendly `.docx` generation |

**Poll flow:**

1. For each enabled source, call the appropriate connector
2. Insert jobs with `INSERT OR IGNORE` on `normalized_key`
3. Update `sources.last_polled_at`
4. Log errors per source without failing the entire batch

**Match flow:**

1. Find jobs without a match row for the candidate
2. Apply exclusion veto (score → 0)
3. Score skills (flat list vs. skill-family domain — take the better fit)
4. Add salary overlap (25 pts) and location fit (15 pts)
5. Insert match row with rationale string

**Skill families** (`match.ts`) group related terms (virtualization, identity, security, etc.) so specialist postings are not penalized for omitting unrelated profile skills. Families are hardcoded for the original candidate but serve as a template for customization.

### Routes (`routes/`)

Thin HTTP handlers — validate input, call db/pipeline functions, serialize responses. No business logic in routes beyond request validation.

Registered in `routes/index.ts`:

- `overview`, `matches`, `pipeline` — Read dashboards
- `scan` — Manual poll + rescore triggers
- `sources` — CRUD for job feeds
- `applications` — Draft, tailor, approve, download, Telegram
- `profile` — Settings + notification config
- `documents` — File listing/serving from `data/documents/`
- `audit` — Recent log entries

### LLM layer (`llm/`)

| Module | Purpose |
|--------|---------|
| `client.ts` | Shared Anthropic client, model config, cost estimation |
| `tailor.ts` | Structured application tailoring with strict honesty rules |
| `mine-bullets.ts` | Bulk extraction of resume bullets from documents |

**Tailoring philosophy:**

- Never invent experience, metrics, or employers
- Preserve numbers and proper nouns exactly
- `keywordGaps` lists honest missing terms; `coveredButUnstated` catches silent ATS failures
- `fitAssessment` must include reasons *not* to apply when applicable

Two tailoring paths share the same rules and Zod schema:

1. **SDK path** — `tailorApplication()` calls Anthropic directly (not wired to a route yet; available for future use)
2. **Agent path** — MCP agent reads context, writes tailoring, saves via API

### Documents pipeline (`documents/`)

Offline tooling for building the accomplishment library:

| Module | Role |
|--------|------|
| `extract-text.ts` | Pull text from PDF, DOCX, TXT, MD |
| `dedupe.ts` | Fingerprint-based deduplication |
| `classify.ts` | Sort bullets into summary/credential/accomplishment |
| `attribute.ts` | Link bullets to source documents |

Orchestrated by `mine-library.ts` with checkpoint/resume support in `data/mining-batches/`.

### Notifications (`notify/telegram.ts`)

- **Digest** — Batched plain-text message of strong unnotified matches
- **Resume delivery** — Sends `.docx` to chat for mobile application workflows
- **Test message** — Connectivity check from settings UI

Telegram uses plain text (not Markdown) because job titles contain characters that break parsers. Jobs are marked `notified_at` only after successful send.

## Scheduler behavior

Two schedulers exist:

1. **Server scheduler** (`server/scheduler.ts`) — Polls job sources on cadence
2. **Auto scheduler** (`auto/src/scheduler.ts`) — Auto-drafts strong matches without drafts

The server scheduler:

- Runs every 60 seconds
- Checks `sources` where `enabled = 1` and cadence has elapsed
- Polls → matches → notifies (Telegram errors do not block polling)
- Uses `timer.unref()` so it does not keep the process alive alone

## Frontend

Static SPA in `public/` — no build step. `app.js` fetches REST endpoints and renders the dashboard. Served by `@fastify/static` with `index.html` as the default.

The UI covers overview metrics, match list with review dialog, pipeline kanban, source management, document browser, and agent settings with live score distribution feedback.

## Data files (gitignored)

| Path | Contents |
|------|----------|
| `server/profile.json` | Candidate profile source of truth (seeded to DB) |
| `server/data/orbit.db` | SQLite database |
| `server/data/documents/` | Source resume/CV files |
| `server/data/bullet-library.json` | LLM-mined bullet output |
| `server/data/mining-batches/` | Checkpoint files for resumable mining |
| `server/.env` | API keys and secrets |

## Extension points

1. **New connector** — Add fetch function, register in `poll.ts`, update `SOURCE_TYPES` and `capabilities.ts`
2. **New match signal** — Extend `scoreJob()` in `match.ts` (keep total ≤ 100 or rescale)
3. **New notification channel** — Follow `notify/telegram.ts` pattern; wire into scheduler
4. **Authentication** — Would require middleware, multi-candidate support, and session management
5. **Submission integration** — Explicitly out of scope; approval only returns the posting URL

## Known limitations (Phase 1)

- Single candidate, no auth
- Server binds localhost only
- No automated tests
- Skill families are candidate-specific hardcoding
- Weekly progress chart in UI is placeholder data
- LLM SDK tailoring not exposed as a direct API route (agent path preferred)
