# Orbit — job-search agent prototype

This is a dependency-free product prototype for an agentic job-search dashboard. Open `index.html` in a modern browser to use the UI.

## Production architecture

1. **Source connectors** pull permitted feeds, email alerts, ATS career pages, and approved job-site integrations on a schedule.
2. **Normalizer + deduplicator** stores positions in a database and prevents repeated applications.
3. **Matching agent** compares a role against the candidate profile, skills, salary/location limits, and exclusion list.
4. **Application agent** creates a tailored draft using approved resume variants and explicitly factual candidate data.
5. **Review / submit gateway** logs the draft, provides a final confirmation, and then opens or uses an approved submission integration.

## Important implementation boundaries

- Do not scrape or bypass access controls, CAPTCHAs, or site terms. Prefer official APIs, alert emails, RSS feeds, direct employer career pages, and ATS integrations.
- Keep a final approval step for each application or a narrowly scoped approval policy. Automated submissions can answer screening questions incorrectly, create duplicate applications, or violate a board's rules.
- Store credentials in a secrets manager, encrypt candidate documents, and retain an audit log of source, draft, and submission status.

## Next build steps

- Add authentication and a candidate profile editor.
- Implement approved source adapters with OAuth/API keys where available.
- Add a background worker and scheduler, persistent database, and email/SMS digest.
- Connect a document generator and a human-controlled browser handoff for application completion.
