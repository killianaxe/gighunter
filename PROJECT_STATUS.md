# Orbit — Project Status

_Last updated: 2026-08-18_

## What's completed

### v1 — core pipeline (done, verified)
Full README "production architecture" implemented and wired to a live UI: source connectors → normalizer/dedupe → matcher (0–100 score) → draft agent (tailors your real resume bullets to each JD, no fabrication) → review/approve gateway that only ever opens the real posting URL for you to submit yourself. Nothing auto-submits anywhere. Every scan/draft/approval is logged to `audit_log`.

- **Backend**: Fastify + better-sqlite3, `server/` — schema, pipeline, routes, scheduler (polls every minute for any source whose cadence has elapsed).
- **Frontend**: `public/` — real data end-to-end. Red Shift Cybersecurity shield as the sidebar mark + favicon, warm red-orange-pink accent palette, product name **Orbit**.
- **Your real profile** is loaded in `server/profile.json` (gitignored) — name, 12 core skills, $140k–$190k salary range, Remote active, 8 factual accomplishment bullets used for tailoring.

### v2 Phase 1 — capability-flagged connectors (done, verified live)
Adzuna, Himalayas, and USAJOBS alongside Remotive/RSS, all API-first (no scraping), each advertising machine-readable capabilities via `GET /api/sources/capabilities`. All four live-tested against real credentials and confirmed mapping title/company/location/salary/URL correctly.

Note: USAJOBS is picky about phrasing — "penetration tester" returns zero federal listings (a real empty result, not a bug), while "cybersecurity" returned 812.

### Matching refinements + full resume export (done, verified live)
- **Exclusion filtering**: India and Level 1 exclusions added. Fixed a real false positive — senior JDs mentioning "Level 1/2/3" support tiers were zeroing out strong matches, so "Level N"/"Tier N" terms are now scoped to the job **title** only. See `server/pipeline/match.ts`.
- **`POST /api/rescore`** — re-scores every ingested job against the current profile without re-polling.
- **Full multi-job-history resume export**: `GET /api/applications/:id/resume.docx` generates a real resume — contact header, tailored summary, 5 work-history entries with bullets ranked per-role by JD keyword overlap, Additional Experience, Certifications, Education.

### Session of 2026-08-18 — cleanup, full UI, GitHub, Telegram

**`auto/` workspace repaired (was blocking the whole repo)**
- `auto/package.json` had invalid JSON (stray double comma) — this broke `npm install`/`npm audit`/`--workspaces` at the **repo root**, not just in `auto/`. Fixed, plus added the documented-but-missing `start:scheduler` script.
- Root `build` script ended in a dangling `npm run ` — simplified to `tsc`.
- **Auto-start simplified to native WSL**: `ensure-orbit.ts` no longer hops through `wsl.exe`; it spawns `npm run dev` directly. `ORBIT_WSL_PROJECT_DIR` → `ORBIT_PROJECT_DIR`, defaulting to the parent dir. Verified end-to-end: the scheduler cold-starts Orbit and completes a cycle.
- Created the missing `auto/.env.example`; fixed stale `D:\...` and `../gighunter` path references.
- Blank-env-var bug: `ORBIT_PROJECT_DIR=` (empty) defeated the `??` default, so `npm run dev` ran in the wrong directory. Config now treats blank as unset.

**Dependencies — `npm audit` now reports 0 vulnerabilities**
- Removed `bcrypt`/`@types/bcrypt` — never imported anywhere, and the sole source of a critical `node-tar` chain.
- Upgraded `@fastify/static` 8 → 10 (3 high-severity path-traversal advisories). Server verified serving UI + API after the bump.

**All six sidebar links are now real pages** (previously Pipeline, Documents, and Agent settings were dead anchors with no matching element):
- **Documents** — `GET /api/documents` lists whatever sits in `server/data/documents/` (name, size, date, view link). Read-only mirror of that folder; Orbit never edits your source files. 31 resume/CV files currently on file.
- **Agent settings** — `GET/PATCH /api/profile` edits salary range, target locations (with quick-add presets), exclusions, and skills, then re-scores every ingested job on save. Previously these were only editable by hand-editing `profile.json` + `npm run seed`.
- **Pipeline** — `GET /api/pipeline` buckets every job into New / Matched / Drafted / Approved. Counts verified consistent with `/api/overview`.

**Telegram notifier (`server/notify/telegram.ts`) — live and verified**
- Sends **one batched message** after a scheduled scan when jobs at/above a configurable threshold haven't been announced yet.
- Configurable in Agent settings: on/off toggle, threshold field, and a **Send test** button (`POST /api/profile/test-notification`).
- **Notification state lives on `jobs.notified_at`, not `matches`** — `rescoreAll()` deletes and rebuilds every match row, so storing it there would clear the flag on every settings save and re-announce the entire backlog.
- Existing jobs were backfilled as notified by the migration, so enabling it stays quiet.
- Send failures leave `notified_at` unset so the next scan retries — verified by forcing a failure.
- Bot is **@PymonIIBot**. Credentials in `server/.env` (gitignored).

**Now on GitHub**: <https://github.com/killianaxe/gighunter> (public). `.gitignore` excludes `server/.env`, `server/profile.json`, `server/data/`, `auto/.env`, `auto/downloads/`, `auto/logs/`, `node_modules/`, `dist/`. Verified no credentials or personal data in any commit.

**Current live state**: 260 jobs, 16 active sources (4 each of Adzuna/Himalayas/Remotive/USAJOBS), 15 applications (10 approved, 5 drafted), top match 70%, notifier enabled at a 65% threshold.

## What's NOT implemented yet (later phases, by design)

- **Phase 2**: Jooble, Remote OK, Jobicy, Arbeitnow, The Muse
- **Phase 3**: Greenhouse/Lever/SmartRecruiters/Ashby/Workday ATS-adapter layer
- **Phase 4**: Upwork (contract/freelance lane)
- Separate contract/permanent/temporary weighting in the matcher (currently one undifferentiated score)
- **Two-way Telegram control** (`/find`, `/promote` from your phone). Would need a polling loop + command router, and a **dedicated second bot** — see Known Issues.
- A UI for the capability flags (data exists at `GET /api/sources/capabilities`, nothing renders it)
- Auth / multi-user (intentionally deferred since v1, still single local user)

## Known issues

- **Something else is already polling @PymonIIBot.** It replies to messages with "⚠️ The model provider failed after retries" — an LLM-gateway error from another service (likely the "Hermes/Forge" system described in `ai-job-hunting-agent-prompts.md`, which was **never built here**). Orbit is send-only and coexists fine, but: (a) your job alerts land in the same chat as that bot's errors, and (b) any future two-way control needs a separate bot, since Telegram allows only one poller per token.
- `ai-job-hunting-agent-prompts.md` describes a **different system** ("Forge" — Python, VPS, 4 agent personas, Hermes gateway) than what exists here (Orbit — TypeScript, local, no LLM calls). It's a spec that was never implemented; don't mistake it for documentation of this codebase.
- One Himalayas listing showed a `$0k–$0k` salary tag — a raw-data quirk from that posting, cosmetic only.
- **Data inconsistency worth your review**: your source resumes disagree on whether Kirkham IronTech is current ("Present," used here) or ended December 2025, and NetStandard's dates (2019–2021) overlap Intras Cloud Services' (2018–2023). Check `workHistory` in `server/profile.json`, correct if needed, then `npm run seed`.

## Exact next step

Broaden the search-family keywords. All 16 sources still search a narrow set of terms; your roadmap's full list (Cloud Security Engineer, IAM/Entra Engineer, AI Infrastructure Engineer, etc.) isn't wired in. With Agent settings now editable in the UI, the skills list is easy to tune — but **source queries** are still set per-source at creation time, so this means either adding more sources or building a multi-keyword query strategy.

## How to pick this back up

```bash
cd /home/killian/code/gighunter
npm run dev
```
Then open <http://localhost:3000>. Profile, sources, and scanned jobs all persist in `server/data/orbit.db` — nothing needs re-seeding.

To run the MCP wrapper / auto-drafter:
```bash
npm run mcp                      # MCP server for agent access
node auto/dist/scheduler.js      # auto-drafts strong matches, saves .docx resumes
```
