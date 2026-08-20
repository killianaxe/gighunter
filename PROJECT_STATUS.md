# Gighunter — Project Status

_Last updated: 2026-08-19_

## What's completed

### v1 — core pipeline (done, verified)
Full README "production architecture" implemented and wired to a live UI: source connectors → normalizer/dedupe → matcher (0–100 score) → draft agent (tailors your real resume bullets to each JD, no fabrication) → review/approve gateway that only ever opens the real posting URL for you to submit yourself. Nothing auto-submits anywhere. Every scan/draft/approval is logged to `audit_log`.

- **Backend**: Fastify + better-sqlite3, `server/` — schema, pipeline, routes, scheduler (polls every minute for any source whose cadence has elapsed).
- **Frontend**: `public/` — real data end-to-end. Red Shift Cybersecurity shield as the sidebar mark + favicon, warm red-orange-pink accent palette, product name **Gighunter**.
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
- **Auto-start simplified to native WSL**: `ensure-orbit.ts` no longer hops through `wsl.exe`; it spawns `npm run dev` directly. `ORBIT_WSL_PROJECT_DIR` → `ORBIT_PROJECT_DIR`, defaulting to the parent dir. Verified end-to-end: the scheduler cold-starts Gighunter and completes a cycle.
- Created the missing `auto/.env.example`; fixed stale `D:\...` and `../gighunter` path references.
- Blank-env-var bug: `ORBIT_PROJECT_DIR=` (empty) defeated the `??` default, so `npm run dev` ran in the wrong directory. Config now treats blank as unset.

**Dependencies — `npm audit` now reports 0 vulnerabilities**
- Removed `bcrypt`/`@types/bcrypt` — never imported anywhere, and the sole source of a critical `node-tar` chain.
- Upgraded `@fastify/static` 8 → 10 (3 high-severity path-traversal advisories). Server verified serving UI + API after the bump.

**All six sidebar links are now real pages** (previously Pipeline, Documents, and Agent settings were dead anchors with no matching element):
- **Documents** — `GET /api/documents` lists whatever sits in `server/data/documents/` (name, size, date, view link). Read-only mirror of that folder; Gighunter never edits your source files. 31 resume/CV files currently on file.
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

**Live state at the end of that session**: 260 jobs, 16 active sources, 15 applications, top match 70%.

### Session of 2026-08-19 — scoring fixes, bullet library, MCP tailoring, dark console UI

Committed but not yet described here when the day started (see `git log`): the master bullet
library mined from 25 years of resume drafts, tailoring moved onto MCP so it bills the Claude Pro
subscription instead of Anthropic API credits, the substring skill-matching fix
(`containsWholeWord`, which moved 34 jobs out of the strong band), the first test suite, and the
dark console retheme.

### Session of 2026-08-19 (continued) — Phase 2 connectors, Telegram resume links, rename

**Phase 2 connectors — all five built, four live-verified**

Jooble, Remote OK, Jobicy, Arbeitnow and The Muse, bringing the connector count to ten. Four are
keyless and were verified against the real APIs; Jooble needs a free `JOOBLE_API_KEY` and
currently fails with a clear credential error, exactly like Adzuna does without its key.

The important finding is that **most of these boards cannot search**, which the v1 connector
contract had assumed every board could:

- **Remote OK** accepts `?tag=` and ignores it. All tags return the identical 101-item feed;
  `tag=golang` led with "General Cleaner Caribe Hilton".
- **Arbeitnow** takes no query parameter at all — it is a paginated firehose, Germany-weighted.
- **The Muse** has no free-text parameter, only `category`. That still matters: it narrows 408,793
  listings across 20,440 pages down to ~1,500 for "Computer and IT".
- **Jobicy** has a `tag` filter that matches far too loosely to trust — `tag=vmware` returned a
  Technical Product Marketer, `tag=active directory` returned an International SEO Manager.

So those four fetch what the board offers and filter locally in `server/connectors/relevance.ts`,
and their `search` capability flag honestly reads `false`. Two bugs found by running the
connectors against live data rather than by reading their docs:

- Filtering on the **full job description** is far too permissive — "engineer" matched a Fire
  Fighter posting, "security" matched an AV Support Coordinator, because a long JD mentions those
  words somewhere almost every time. Matching is now on title plus the board's own tag/category
  metadata, which is what a board's own search weights. The Muse went from 116 hits to 5 genuine
  ones on "security".
- **Remote OK's tags are not a usable signal at all** — "General Cleaner" was tagged `golang` and
  `infosec`, "Fire Fighter" was tagged `engineer`, and 34 of 100 listings carried `engineer`
  regardless of role. Remote OK alone matches on title and company only.
- `stripHtml` had its operations backwards: it stripped tags before decoding entities, so
  Arbeitnow's double-escaped markup had a fresh layer of `<div>` tags *revealed* after the strip
  pass had already run. Entities are now decoded first.

Configuration note worth not rediscovering: **Remote OK sources want single broad terms**
("security", "engineer"), not phrases. Its feed holds only ~100 rotating listings, so a two-word
AND query matched zero of them while "engineer" alone matched nine. The scorer does the narrowing.

`GET /api/sources/capabilities` now covers all ten boards, and the dashboard's "Add source" prompt
reads its list from that endpoint instead of a hardcoded copy that could drift.

**Telegram digests now carry a link to the tailored resume for each opportunity**

Each digest entry gained a `📄 Resume:` line. Making that work required a behavioural change: a
scan runs poll → score → notify, but applications were only drafted on demand or by the
auto-scheduler at its higher threshold, so at digest time a new match had no application and every
link would have been null. `notifyStrongMatches` now drafts every match it is about to announce
(`ensureDrafted`). That is affordable because `buildDraft` is local keyword-overlap bullet
selection — no network, no LLM — and it is idempotent, since the insert upserts on
`(job_id, candidate_id)`.

That change broke the auto-scheduler in a way worth recording, because it was silent: the
scheduler selected work with `applicationStatus === null`, i.e. it used **"not yet drafted" as a
proxy for "resume not yet delivered"**. Once the notifier drafts everything, nothing is undrafted,
and the scheduler would have quietly stopped pushing .docx files to the phone. Delivery is now
tracked explicitly on `applications.resume_sent_at`, set only after Telegram accepts the upload,
and the scheduler selects on that. The migration backfills it from the `telegram_resume_sent`
audit events — and runs **unconditionally**, not gated on the ALTER, because an earlier boot can
add the column before the backfill exists and gating would then skip it forever, re-sending the
entire history as duplicates.

**Known limit, by design**: resume links default to `http://127.0.0.1:3000`, which resolves on
this machine and *not* on a phone, where 127.0.0.1 is the phone itself. Set
`GIGHUNTER_PUBLIC_BASE_URL` to a reachable host (Tailscale name, LAN address, tunnel) to make them
work on mobile. The .docx pushed into the chat remains the copy that works anywhere.

**Renamed Orbit → Gighunter**

74 standalone occurrences across UI, docs, comments, Telegram message text and the HTTP
User-Agent, using a word-boundary match so camelCase identifiers in `auto/src`
(`ensureGighunterRunning` would have been churn) were left alone. The sidebar wordmark went from
34px to 44px.

**Deliberately NOT renamed** (each would break something live):
- `server/data/orbit.db` — the database file holding all the data.
- `ORBIT_*` env vars in `auto/.env`.
- `orbit_*` MCP tool names — registered with Claude Code and named in `auto/tailor-queue.sh`'s
  `--allowedTools` list.

**Tests**: 11 → 39, covering the relevance filter, Jooble's free-text salary parsing, `stripHtml`
entity ordering, and digest formatting including the 4096-char Telegram ceiling.

## What's NOT implemented yet (later phases, by design)

- **Phase 3**: Greenhouse/Lever/SmartRecruiters/Ashby/Workday ATS-adapter layer
- **Phase 4**: Upwork (contract/freelance lane)
- Separate contract/permanent/temporary weighting in the matcher (currently one undifferentiated score)
- **Two-way Telegram control** (`/find`, `/promote` from your phone). Would need a polling loop + command router, and a **dedicated second bot** — see Known Issues.
- A UI for the capability flags (data exists at `GET /api/sources/capabilities`, nothing renders it)
- Auth / multi-user (intentionally deferred since v1, still single local user)

## Known issues

- **Something else is already polling @PymonIIBot.** It replies to messages with "⚠️ The model provider failed after retries" — an LLM-gateway error from another service (likely the "Hermes/Forge" system described in `ai-job-hunting-agent-prompts.md`, which was **never built here**). Gighunter is send-only and coexists fine, but: (a) your job alerts land in the same chat as that bot's errors, and (b) any future two-way control needs a separate bot, since Telegram allows only one poller per token.
- `ai-job-hunting-agent-prompts.md` describes a **different system** ("Forge" — Python, VPS, 4 agent personas, Hermes gateway) than what exists here (Gighunter — TypeScript, local, no LLM calls). It's a spec that was never implemented; don't mistake it for documentation of this codebase.
- One Himalayas listing showed a `$0k–$0k` salary tag — a raw-data quirk from that posting, cosmetic
  only. The Phase 2 connectors guard against this shape at the boundary (`nullableSalary` maps a
  board's 0 to "unknown" rather than "pays nothing"); Himalayas itself has not been given the guard.
- **Data inconsistency worth your review**: your source resumes disagree on whether Kirkham IronTech is current ("Present," used here) or ended December 2025, and NetStandard's dates (2019–2021) overlap Intras Cloud Services' (2018–2023). Check `workHistory` in `server/profile.json`, correct if needed, then `npm run seed`.

## Current live state

881 jobs · 61 of 64 sources active · 106 applications · 72 matches at 80%+ · notifier at 55%

Jobs by board: adzuna 375, usajobs 212, himalayas 189, jobicy 61, remotive 17, remoteok 11,
arbeitnow 9, themuse 7. (Adzuna dominates because it has the most sources configured and a real
searchable index, not because the new boards underperform.)

**80 of 106 applications have had their resume delivered to Telegram. Only 4 of 106 are
LLM-tailored** — see the next step.

## Exact next step

**Drain the tailoring backlog.** 102 of 106 applications have no tailoring, including every one of
the 100%-scoring matches. Everything delivered to the phone so far was built from the *rule-based*
draft — bullets selected by keyword overlap — not from the LLM tailoring that `auto/tailor-queue.sh`
produces. The four that did complete look good (real rewrites, source numbers preserved verbatim,
honest `fitAssessment`), so the pipeline works; it simply has not been run through the queue.

```bash
./auto/tailor-queue.sh 10     # start with ten, it paces itself against the Pro usage window
```

Two smaller things after that:

- **Score saturation.** 16 jobs sit at exactly 100% with *nothing* in the 90–99 band — the
  signature of clamping, not of genuine perfect fits. The top of the funnel is currently
  unrankable.
- **Jooble** is built but idle until `JOOBLE_API_KEY` is set (free, from jooble.org/api/about).
  It is the only Phase 2 board with real server-side search.

## How to pick this back up

```bash
cd /home/killian/code/gighunter
npm run dev                      # dashboard at http://localhost:3000
cd auto && npm run start:scheduler   # auto-drafts 80%+ matches, delivers resumes to Telegram
```

Profile, sources and scanned jobs persist in `server/data/orbit.db` — nothing needs re-seeding.
Note the scheduler cold-starts the server itself if it is not already running, so starting the
scheduler alone is enough.

```bash
npm test                         # 39 tests
npm run mcp                      # MCP server for agent access
```
