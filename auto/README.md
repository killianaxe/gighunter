# autogighunter

An MCP wrapper and auto-draft scheduler for [Orbit](..) — lets any MCP-compatible agent
(Claude Code, Claude Desktop, etc.) call Orbit as tools, and auto-drafts applications for strong
matches so there's minimal manual work before you apply.

This project holds no data of its own — no database, no candidate profile. Everything is a thin
layer over Orbit's existing REST API (`../server`). Orbit's own internal scheduler
still owns source polling; this project only adds the missing piece: automatic drafting.

**What it will never do**: submit an application anywhere. Approving an application only unlocks
the real posting URL for a human to open and finish themselves — the same safeguard Orbit's UI
has always had.

## Setup

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` and adjust if needed — the defaults assume Orbit lives in the
parent directory (`..`) and is reachable at `http://127.0.0.1:3000`.

## Using it as an MCP server

Register it with Claude Code:

```bash
claude mcp add --transport stdio autogighunter -- node /home/killian/code/gighunter/auto/dist/mcp-server.js
```

That gives any Claude Code session tools like `orbit_matches`, `orbit_scan`,
`orbit_draft_application`, `orbit_download_resume`, `orbit_pending_review`, and
`orbit_approve_application`. If Orbit's server isn't running when a tool is called, it's
auto-started (`AUTO_START_ORBIT=true` by default) — no need to remember to start it
yourself first.

## Running the auto-draft scheduler

```bash
npm run start:scheduler
```

Every `AUTO_DRAFT_INTERVAL_MINUTES` (default 15), it checks Orbit for matches scoring at or above
`AUTO_DRAFT_THRESHOLD` (default 70 — Orbit's own "strong match" cutoff) that don't have a draft
yet, drafts them, and saves the tailored `.docx` resume to `RESUME_DOWNLOAD_DIR` (default
`./downloads`). Progress is logged to `logs/YYYY-MM-DD.log`.

This is meant to run continuously in the background. Two easy ways to keep it alive without
babysitting a terminal:

- Leave it running in a dedicated terminal window.
- Use [pm2](https://pm2.keymetrics.io/): `npm install -g pm2`, then
  `pm2 start dist/scheduler.js --name autogighunter && pm2 save`. Add `pm2 startup` if you want it
  to survive a reboot.

(A full Windows Task Scheduler / service wrapper wasn't built here — pm2 is the lower-effort path
for a single-user local tool like this.)

## What "minimal work to apply" actually means here

1. Orbit's own scheduler polls your sources automatically (already true before this project).
2. This scheduler auto-drafts + auto-generates resumes for anything strong (score ≥ 70).
3. You open Orbit's Review dialog (or ask an agent for `orbit_pending_review`), skim what's
   ready, and click through to actually apply on the real posting.

Step 3 is the only manual step left, and it's deliberately staying that way.
