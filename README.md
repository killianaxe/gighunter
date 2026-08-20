# Gighunter

**Author:** Michael Cumberland

Gighunter is a local-first job search agent that polls approved job sources, scores listings against your profile, drafts tailored application materials from your real resume facts, and helps you review and apply — without ever auto-submitting.

> The codebase and UI still use the working title **Gighunter** in places (package name, branding). Gighunter is the product name.

## Features

- **Multi-source job polling** — ten connectors via official APIs: Remotive, Himalayas, Adzuna, USAJOBS,
  Jooble, Remote OK, Jobicy, Arbeitnow, The Muse, and custom RSS feeds
- **Honest capability flags** — `GET /api/sources/capabilities` states per board whether it can really
  search, whether it reports salary, and what it costs. Boards that cannot search are filtered locally
- **Smart matching** — Skills, salary, location, and exclusion-based scoring (0–100)
- **Application drafting** — Rule-based and LLM-assisted tailoring with strict honesty constraints
- **Resume export** — ATS-friendly `.docx` generation per application
- **Web dashboard** — Overview, matches, pipeline, sources, documents, and settings
- **Telegram notifications** — Optional digest of strong matches and mobile resume delivery
- **MCP integration** — Optional `auto/` layer for Claude Code agent workflows

## Quick start

```bash
npm install
cp server/.env.example server/.env      # Add API keys as needed
cp server/profile.example.json server/profile.json  # Edit with your details
npm run seed
npm run dev
```

Open **http://127.0.0.1:3000** and click **Run agent**.

See [server/README.md](./server/README.md) for full setup, configuration, and usage.

## Project structure

| Directory | Description |
|-----------|-------------|
| [server/](./server/) | Fastify API, pipeline, connectors, SQLite, LLM |
| [public/](./public/) | Static web dashboard |
| [auto/](./auto/) | MCP server + auto-draft scheduler |

## Documentation

- [Server README](./server/README.md) — Installation, configuration, usage
- [Architecture](./server/docs/architecture.md) — System design and data flow
- [REST API](./server/docs/api.md) — Endpoint reference
- [Auto/MCP](./auto/README.md) — Agent integration and auto-drafting

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server with hot reload |
| `npm run start` | Start server |
| `npm run seed` | Sync profile → database |
| `npm run mine` | LLM bullet extraction from documents |
| `npm run mcp` | Start MCP server (auto workspace) |

## Important boundaries

- Connectors use **official APIs only** — no scraping or access-control bypass
- **Nothing is auto-submitted** — approving an application only unlocks the real posting URL
- Server binds **127.0.0.1 only** — designed as a local single-user tool
- Personal data (`profile.json`, database, documents) stays on your machine (gitignored)

## License

Private project.
