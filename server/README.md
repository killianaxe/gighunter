# Gighunter Server

**Author:** Michael Cumberland

Gighunter is a local-first job search agent. The server polls approved job sources on a schedule, scores listings against your profile, drafts tailored application materials from your real resume facts, and exposes everything through a REST API and a bundled web dashboard.

> **Naming note:** The codebase and UI still use the working title **Orbit** in many places (package name, Telegram messages, UI branding). Gighunter is the product name; Orbit refers to the same system.

## What it does

1. **Source connectors** — Pull listings from Remotive, Himalayas, Adzuna, USAJOBS, and custom RSS feeds via official APIs (no scraping).
2. **Normalizer + deduplicator** — Stores jobs in SQLite and dedupes by normalized title/company key.
3. **Matching engine** — Scores each job (0–100) against skills, salary range, location preferences, and exclusion keywords.
4. **Application drafting** — Builds headline, summary, and bullet selections from your profile; optional LLM tailoring via Anthropic.
5. **Review gateway** — Approving an application only unlocks the real posting URL. Nothing is ever auto-submitted.
6. **Telegram notifier** — Optional digest of strong matches and delivery of tailored `.docx` resumes to your phone.

## Repository layout

This directory (`server/`) is the Fastify backend. The full Gighunter project also includes:

| Path | Purpose |
|------|---------|
| `server/` | API, pipeline, connectors, SQLite, LLM integration |
| `public/` | Static web dashboard served at `http://127.0.0.1:3000` |
| `auto/` | MCP server + auto-draft scheduler (optional automation layer) |

```
gighunter/
├── package.json          # Root scripts: dev, start, seed, mine
├── public/               # Dashboard UI (index.html, app.js, styles.css)
├── server/               # ← You are here
│   ├── index.ts          # Fastify entry point
│   ├── env.ts            # Loads server/.env
│   ├── scheduler.ts      # Background source polling loop
│   ├── seed.ts           # Profile → database bootstrap
│   ├── profile.json      # Your candidate profile (gitignored)
│   ├── profile.example.json
│   ├── .env              # Secrets (gitignored)
│   ├── .env.example
│   ├── connectors/       # Job source adapters
│   ├── pipeline/         # Poll, match, draft, resume export
│   ├── routes/           # REST API handlers
│   ├── db/               # SQLite schema, migrations, types
│   ├── llm/              # Anthropic client, tailoring, bullet mining
│   ├── documents/        # Resume/CV text extraction and classification
│   ├── notify/           # Telegram integration
│   └── data/             # SQLite DB, documents, mining output (gitignored)
└── auto/                 # MCP wrapper (see auto/README.md)
```

## Requirements

- **Node.js** 20+ (ES modules, native `fetch`)
- **npm** (workspace root at `gighunter/`)
- **Linux/WSL/macOS** recommended (project developed on WSL Ubuntu)
- Native build tools for `better-sqlite3` (`python3`, `make`, `g++` on Linux)

## Getting started

From the **project root** (`gighunter/`, one level above this directory):

```bash
# Install dependencies (includes auto workspace)
npm install

# Copy and edit environment variables
cp server/.env.example server/.env
# Edit server/.env with your API keys (see Configuration below)

# Create your profile from the template
cp server/profile.example.json server/profile.json
# Edit server/profile.json with your real details

# Bootstrap the database and seed default sources
npm run seed

# Start the dev server (hot reload via tsx)
npm run dev
```

Open **http://127.0.0.1:3000** in your browser. Click **Run agent** to trigger an immediate scan, or wait for the background scheduler (checks every 60 seconds for due sources).

### Production start

```bash
npm run build   # Compiles server/**/*.ts → dist/
npm start       # Runs server/index.ts via tsx
```

The server binds to `127.0.0.1` only — it is designed as a local tool, not a public-facing service.

## Configuration

Environment variables are loaded from `server/.env` by `server/env.ts`. Existing shell variables take precedence (the loader never overwrites keys already in `process.env`).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `./data/orbit.db` | SQLite file (relative to `server/` or absolute) |
| `DEFAULT_USER_ID` | `default-user` | Candidate ID for Phase 1 (no auth yet) |
| `ADZUNA_APP_ID` | — | [Adzuna API](https://developer.adzuna.com/) app ID |
| `ADZUNA_APP_KEY` | — | Adzuna API key |
| `ADZUNA_COUNTRY` | `us` | Adzuna country code |
| `USAJOBS_API_KEY` | — | [USAJOBS](https://developer.usajobs.gov/) authorization key |
| `USAJOBS_USER_AGENT` | — | Your email (required User-Agent) |
| `TELEGRAM_BOT_TOKEN` | — | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | — | Your chat ID (message the bot once, then check getUpdates) |
| `ANTHROPIC_API_KEY` | — | Required for LLM tailoring and bullet mining |
| `MINING_MODEL` | `claude-opus-5` | Override model for bulk bullet extraction |

See `server/.env.example` for a copy-paste template.

### Candidate profile (`profile.json`)

Your profile drives matching and drafting. Key fields:

- **skills** — Used for 60% of match score
- **salaryMin / salaryMax** — 25% of score
- **locations** — Include `"Remote"` for remote-friendly matching (15% of score)
- **exclusions** — Any match zeroes the job (e.g. `"internship"`, `"Level 1"`)
- **resumeBullets** — Flat accomplishment pool with keywords for drafting
- **workHistory** — Full employment history for `.docx` resume export
- **certifications, education, additionalExperience** — Resume sections

After editing `profile.json`, re-run:

```bash
npm run seed
```

Then either save settings in the UI (which triggers rescore) or call `POST /api/rescore`.

### Agent settings (database)

Notification and scoring tuning live in the `app_settings` table and are editable from the **Agent settings** panel in the UI:

| Setting | Default | Description |
|---------|---------|-------------|
| `notifyEnabled` | `false` | Master Telegram switch (opt-in) |
| `notifyThreshold` | `70` | Minimum score for notifications |
| `skillTarget` | `5` | Skills needed for full flat skill credit |
| `skillFamilyTarget` | `4` | Terms from one skill family for domain match |

## Usage

### Web dashboard

The dashboard at `http://127.0.0.1:3000` provides:

- **Overview** — Metrics, next scan time, run/pause agent
- **Matches** — Ranked job list with scores and rationale
- **Pipeline** — Jobs bucketed by stage (new → matched → drafted → approved)
- **Sources** — Add/enable/disable job sources
- **Documents** — View resume/CV files from `server/data/documents/`
- **Agent settings** — Tune scoring, exclusions, Telegram

### CLI scripts

Run from project root:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server with hot reload |
| `npm run start` | Start server |
| `npm run seed` | Sync `profile.json` → database, seed default sources |
| `npm run mine` | Extract bullets from documents via LLM (requires `ANTHROPIC_API_KEY`) |
| `npm run mine -- 1` | Mine only the first batch (canary run) |

Additional one-off scripts in `server/` (run via `tsx`):

| Script | Purpose |
|--------|---------|
| `wire-library.ts` | Merge mined bullets from `data/bullet-library.json` into `profile.json` |
| `repair-library.ts` | Rebuild bullet library from mining batch checkpoints |
| `mine-library.ts` | Full document → LLM → bullet library pipeline |

### Background scheduler

`server/scheduler.ts` runs automatically when the server starts. Every 60 seconds it:

1. Finds enabled sources whose `cadence_minutes` has elapsed
2. Polls them via connectors
3. Scores new jobs against your profile
4. Sends Telegram digest for unnotified strong matches (if enabled)

Trigger a manual scan from the UI or `POST /api/scan`.

## Architecture

See [docs/architecture.md](./docs/architecture.md) for a detailed system overview.

High-level flow:

```
Sources (connectors) → poll → jobs (SQLite)
                              ↓
                     match (score 0–100)
                              ↓
                     draft / tailor → applications
                              ↓
                     approve → real job URL (human applies)
```

### Job sources

| Type | Auth | Input |
|------|------|-------|
| `remotive` | None | Search keyword |
| `himalayas` | None | Search keyword |
| `adzuna` | API key | Search keyword |
| `usajobs` | API key + email | Search keyword |
| `rss` | None | Feed URL |

Capabilities per source are documented at `GET /api/sources/capabilities`.

### Matching algorithm

Score breakdown (max 100):

- **Skills (60 pts)** — Best of flat profile skill overlap or skill-family domain match
- **Salary (25 pts)** — Range overlap with your target
- **Location (15 pts)** — Remote or named location match
- **Exclusions** — Any whole-word match in title/description/location → score 0

### Application drafting

Two paths:

1. **Rule-based draft** (`POST /api/applications/:jobId/draft`) — Selects bullets by keyword overlap, no LLM cost.
2. **LLM tailoring** — Agent reads `GET .../tailoring-context`, writes tailoring, saves via `POST .../tailoring`. Same Zod schema and honesty rules as the SDK path in `llm/tailor.ts`.

Generated resumes export as ATS-friendly `.docx` (Georgia font, no tables/text boxes).

## API reference

Full endpoint documentation: [docs/api.md](./docs/api.md).

Quick reference:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/overview` | Dashboard summary |
| GET | `/api/matches` | Ranked matches |
| GET | `/api/pipeline` | Jobs by stage |
| POST | `/api/scan` | Poll all enabled sources + score |
| POST | `/api/rescore` | Re-score ingested jobs |
| GET/POST/PATCH | `/api/sources` | Manage sources |
| GET/PATCH | `/api/profile` | Profile + agent settings |
| POST | `/api/profile/test-notification` | Test Telegram |
| GET/POST | `/api/applications/...` | Draft, tailor, approve, download |
| GET | `/api/documents` | List/view source documents |
| GET | `/api/audit` | Recent audit log (50 entries) |

## Development

### Tech stack

- **Runtime:** Node.js, TypeScript (ES2022, NodeNext modules)
- **HTTP:** Fastify 5 + CORS + static file serving
- **Database:** better-sqlite3 (WAL mode, foreign keys)
- **LLM:** @anthropic-ai/sdk (structured output via Zod)
- **Documents:** docx, mammoth (DOCX extraction)
- **Validation:** Zod 4

### Project conventions

- Source files use `.ts`; imports use `.js` extensions (NodeNext resolution)
- `server/env.ts` must be imported first in entry scripts
- Personal data (`profile.json`, `data/`, `.env`) is gitignored
- Audit log records significant actions (polls, drafts, approvals)
- Static files served only from `public/` — never the project root

### Adding a connector

1. Create `server/connectors/mysource.ts` exporting `fetchMySource(query: string): Promise<NormalizedListing[]>`
2. Add the type to `SOURCE_TYPES` in `db/types.ts`
3. Register in `pipeline/poll.ts` `CONNECTORS` map
4. Document capabilities in `connectors/capabilities.ts`

### MCP / automation

The `auto/` workspace wraps this server's REST API as MCP tools for Claude Code and runs an optional auto-draft scheduler. See [../auto/README.md](../auto/README.md).

## Testing

There is **no automated test suite** in this repository yet. Manual verification:

1. `npm run seed` — Profile loads without error
2. `npm run dev` — Server starts, dashboard loads
3. **Run agent** — Sources poll, matches appear
4. Draft an application — Review dialog shows headline/bullets
5. Download `.docx` — File opens with correct content
6. `POST /api/profile/test-notification` — Telegram test (if configured)

## Security and boundaries

- Server listens on **127.0.0.1 only** — not exposed to the network by default
- **No authentication** in Phase 1 — single-user local tool
- Connectors use **official APIs only** — no scraping or CAPTCHA bypass
- **Never auto-submits** applications — approval only unlocks the posting URL
- Secrets stay in `server/.env` (gitignored); Telegram token is never returned by the API
- Resume/documents in `server/data/` are local and gitignored

## Related documentation

- [Architecture overview](./docs/architecture.md)
- [REST API reference](./docs/api.md)
- [Auto/MCP layer](../auto/README.md)

## License

Private project — not published to npm (`"private": true`).
