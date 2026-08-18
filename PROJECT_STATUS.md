# Orbit — Project Status

_Last updated: 2026-08-16_

## What's completed

### v1 — core pipeline (done, verified)
Full README "production architecture" implemented and wired to a live UI: source connectors → normalizer/dedupe → matcher (0–100 score) → draft agent (tailors your real resume bullets to each JD, no fabrication) → review/approve gateway that only ever opens the real posting URL for you to submit yourself. Nothing auto-submits anywhere. Every scan/draft/approval is logged to `audit_log`.

- **Backend**: Fastify + better-sqlite3, `server/` — schema, pipeline, routes, scheduler (polls every minute for any source whose cadence has elapsed).
- **Frontend**: `public/` — real data end-to-end, no more mock/fake content. Rebranded: Red Shift Cybersecurity shield as the sidebar mark + favicon (doubled in size per your request — 52px mark / 46px text), warm red-orange-pink accent palette replacing the original lime/purple, product name settled on **Orbit**.
- **Your real profile** is loaded in `server/profile.json`, reconciled from your three resume/CV files: name, 12 core skills, $140k–$190k salary range, Remote as the active location (7 other candidate cities documented in the file under `_locationPresets_editToActivate` for you to activate later), and 8 factual accomplishment bullets used for tailoring.

### v2 Phase 1 — capability-flagged connectors (done, verified live)
Per your roadmap: Adzuna, Himalayas, and USAJOBS added alongside the existing Remotive/RSS connectors, all API-first (no scraping), each advertising machine-readable capabilities (search/filter/fullJd/salary/remote/contractType/applicationUrl/applicationApi/authRequired/registrationRequired/cost/rateLimit/terms) via `GET /api/sources/capabilities`.

- **Adzuna** — live-tested with your real API credentials (in `server/.env`). Confirmed real listings ingesting with correct title/company/location/salary/URL mapping.
- **Himalayas** — no key needed, live-tested. Confirmed real listings ingesting correctly.
- **USAJOBS** — live-tested with your real API key + registered email (`server/.env`). Field mapping (`SearchResult.SearchResultItems[].MatchedObjectDescriptor`) confirmed correct against the raw API — 23 real cybersecurity postings ingested (title/company/location/salary/URL all correct), e.g. "IT Cybersecurity Specialist" at $89.5k–$145.5k. Note: the API is picky about phrasing — "penetration tester" returned zero federal listings (that's a real, empty result, not a bug — federal titles rarely use that exact phrase), while "cybersecurity" returned 812 total matches. Worth keeping in mind when picking USAJOBS query terms.
- `sources.type` schema constraint was migrated (old CHECK dropped, rebuilt table in place) — confirmed your existing Remotive source survived with its original `id` intact, zero data loss.
- Add-source flow in the UI now asks for a type first (remotive/himalayas/adzuna/usajobs/rss), then the query/URL.

**Live scan right now**: all 4 API-based sources active and verified (Remotive, Himalayas, Adzuna, USAJOBS), 81 real jobs ingested, top match scoring 70% ("Sr. Systems Engineer" at Computer World Services Corp, $145k–$155k, remote). Phase 1 is fully closed out — every connector has ingested and correctly mapped real data at least once.

### Matching refinements + full resume export (done, verified live)

- **Exclusion filtering fixed and extended**: added India (location) and Level 1 (title/seniority) exclusions per your request, plus a broader "intern" catch. Caught and fixed a real false-positive during verification — senior job descriptions that mention "Level 1/2/3" support tiers (e.g. "mentors Level 1 and Level 2 engineers") were wrongly zeroing out strong matches, since the check scanned the full description. Fixed by scoping "Level N"/"Tier N"-style terms to the job **title** only, while other exclusions (unpaid, commission-only, india) still check the full text. See `server/pipeline/match.ts`.
- **New `POST /api/rescore`** — re-scores every already-ingested job against your current profile without re-polling the external APIs. Use this after editing `server/profile.json` and running `npm run seed`.
- **Full multi-job-history resume export**: `GET /api/applications/:id/resume.docx` now generates a real resume, not just a highlights pitch — contact header (email/phone/LinkedIn/location), tailored summary, **5 full work-history entries** (Kirkham IronTech, Red Shift Cybersecurity, Intras Cloud Services, NetStandard, VMware SRM/J&J) each with real employer/title/dates and up to 5 bullets **ranked per-role** by JD keyword overlap (verified: a cybersecurity-titled posting surfaced different bullets per role than a general systems-engineer posting — confirmed via two side-by-side test drafts), an Additional Experience section condensing your older roles (1999–2022) the same way your own source resume does, plus Certifications and Education. Click "Download .docx" in the Review dialog.
  - Contact info confirmed with you: cumberland25@hotmail.com, 205-421-6244, LinkedIn, Fort Smith AR.
  - **Known data inconsistency, not resolved — worth your review**: your source resumes disagree on whether Kirkham IronTech is current ("Present," used here) or ended December 2025, and NetStandard's dates (2019–2021) overlap with Intras Cloud Services' (2018–2023). Both taken as literally stated in the most complete source document. Check `server/profile.json`'s `workHistory` section and correct if needed, then `npm run seed`.

## What's NOT implemented yet (later phases, by design)

- **Phase 2**: Jooble, Remote OK, Jobicy, Arbeitnow, The Muse
- **Phase 3**: Greenhouse/Lever/SmartRecruiters/Ashby/Workday ATS-adapter layer with employer-side application handoff
- **Phase 4**: Upwork (contract/freelance lane)
- Separate contract/permanent/temporary weighting in the matcher (currently one undifferentiated score)
- The expanded search-family keyword list from your roadmap (Cloud Security Engineer, IAM/Entra Engineer, AI Infrastructure Engineer, etc.) — right now every source just searches "Active Directory"; broadening this is profile/source config work, not connector work
- A UI for the capability flags (the data exists at `GET /api/sources/capabilities`, nothing renders it yet)
- Auth / multi-user (intentionally deferred since v1, still single local user)

## Known issues (minor, non-blocking)

- One Himalayas listing displayed a `$0k–$0k` salary tag — a raw-data quirk from that specific posting (values too small to be annual USD), not a parsing bug. Cosmetic only.
- The exact same Adzuna credentials now in `server/.env` are **also still sitting in plaintext** in `ai-job-hunting-agent-prompts.md` at the project root, left over from earlier planning. Not urgent (free-tier key, low blast radius) but worth scrubbing from that file if it's ever shared or committed anywhere.
- `npm audit` reported some vulnerabilities in transitive build tooling (not runtime) dependencies during the original `npm install` — not investigated, low priority for a local single-user tool.

## Exact next step for tomorrow

Decide whether to broaden the search-family keywords (three of four sources currently search "Active Directory", USAJOBS searches "cybersecurity") before moving on to Phase 2 connectors — more sources searching the same one or two terms adds redundancy, not variety. Your roadmap's full keyword list (Cloud Security Engineer, IAM/Entra Engineer, AI Infrastructure Engineer, etc.) hasn't been wired in yet; that's the natural next unit of work, either as multiple sources per connector or a smarter multi-keyword query strategy.

## How to pick this back up

```bash
cd /home/killian/code/gighunter
npm run dev
```
Then open `http://localhost:3000`. Your profile, all 4 sources, and 81 already-scanned jobs are all persisted in `server/data/orbit.db` — nothing needs to be re-seeded.
