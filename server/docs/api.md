# Gighunter REST API

**Author:** Michael Cumberland

Base URL: `http://127.0.0.1:3000` (default)

All endpoints return JSON unless noted. There is no authentication in Phase 1 — the server is intended to run locally for a single user.

## Overview

### `GET /api/overview`

Dashboard summary metrics.

**Response:**

```json
{
  "candidateName": "Your Name",
  "newRoles": 142,
  "strongMatches": 23,
  "applicationsPrepared": 5,
  "activeSources": 2,
  "nextScanAt": "2026-08-19 14:30:00"
}
```

| Field | Description |
|-------|-------------|
| `newRoles` | Total jobs in database |
| `strongMatches` | Matches with score ≥ 70 |
| `applicationsPrepared` | Total application drafts |
| `activeSources` | Enabled sources count |
| `nextScanAt` | Earliest next scheduled poll (SQLite datetime string, or null) |

---

## Matches

### `GET /api/matches`

All matches for the default candidate, ranked by score descending.

**Response:**

```json
{
  "matches": [
    {
      "jobId": "abc123",
      "title": "Senior Platform Engineer",
      "company": "Example Corp",
      "location": "Remote",
      "url": "https://example.com/jobs/123",
      "salaryMin": 140000,
      "salaryMax": 180000,
      "postedAt": "2026-08-15",
      "score": 85,
      "rationale": "4 virtualization skills matched (100% of a full domain match); Salary range overlaps your target; Location matches (Remote)",
      "applicationId": "app456",
      "applicationStatus": "drafted"
    }
  ]
}
```

`applicationId` and `applicationStatus` are null when no draft exists.

---

## Pipeline

### `GET /api/pipeline`

Jobs grouped by workflow stage.

**Response:**

```json
{
  "stages": {
    "new": [ /* jobs with no match */ ],
    "matched": [ /* scored, no application */ ],
    "drafted": [ /* application status = drafted */ ],
    "approved": [ /* application status = approved */ ]
  },
  "counts": {
    "new": 10,
    "matched": 50,
    "drafted": 3,
    "approved": 1
  }
}
```

Each job object includes: `jobId`, `title`, `company`, `location`, `url`, `salaryMin`, `salaryMax`, `postedAt`, `score`, `rationale`, `applicationId`, `applicationStatus`.

---

## Scan

### `POST /api/scan`

Poll all enabled sources immediately and score new jobs.

**Response:**

```json
{
  "sourcesPolled": 2,
  "listingsSeen": 45,
  "newJobs": 12,
  "errors": [],
  "newMatches": 12
}
```

Errors array contains `{ sourceId, sourceName, message }` for failed sources.

### `POST /api/rescore`

Re-score all ingested jobs against the current profile without re-polling sources. Use after profile or settings changes.

**Response:**

```json
{
  "rescored": 142
}
```

---

## Sources

### `GET /api/sources`

List all configured sources.

**Response:**

```json
{
  "sources": [
    {
      "id": "src123",
      "name": "remotive: platform engineer",
      "type": "remotive",
      "query_or_url": "platform engineer",
      "cadence_minutes": 120,
      "enabled": 1,
      "last_polled_at": "2026-08-19 12:00:00",
      "created_at": "2026-08-01 10:00:00"
    }
  ]
}
```

### `GET /api/sources/capabilities`

Connector capability metadata for each source type.

**Response:**

```json
{
  "capabilities": {
    "remotive": {
      "search": true,
      "filter": false,
      "fullJd": "yes",
      "salary": "partial",
      "remote": true,
      "authRequired": false,
      "cost": "Free"
    }
  }
}
```

### `POST /api/sources`

Add a new source.

**Request body:**

```json
{
  "type": "remotive",
  "input": "devops engineer",
  "name": "Optional display name",
  "cadenceMinutes": 120
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | One of: `remotive`, `himalayas`, `adzuna`, `usajobs`, `rss` |
| `input` | Yes | Search keyword (API sources) or feed URL (`rss`) |
| `name` | No | Display name (auto-generated if omitted) |
| `cadenceMinutes` | No | Poll interval (default 120) |

**Response:** `201` with `{ source }`

**Errors:** `400` if type or input invalid

### `PATCH /api/sources/:id`

Enable or disable a source.

**Request body:**

```json
{
  "enabled": false
}
```

**Response:** `{ source }`

**Errors:** `404` if not found

---

## Profile and settings

### `GET /api/profile`

Current profile fields and agent settings.

**Response:**

```json
{
  "salaryMin": 120000,
  "salaryMax": 180000,
  "locations": ["Remote", "Denver, CO"],
  "exclusions": ["internship", "unpaid"],
  "skills": ["VMware", "Azure", "PowerShell"],
  "locationPresets": ["Fort Smith, AR", "Denver, CO"],
  "notifyEnabled": false,
  "notifyThreshold": 70,
  "skillTarget": 5,
  "skillFamilyTarget": 4,
  "telegramConfigured": true,
  "distribution": {
    "total": 142,
    "at55": 80,
    "at65": 45,
    "at75": 23,
    "at85": 10,
    "at90": 5
  }
}
```

### `PATCH /api/profile`

Update profile and/or agent settings. Triggers automatic rescore of all jobs.

**Request body** (all fields optional):

```json
{
  "salaryMin": 130000,
  "salaryMax": 190000,
  "locations": ["Remote"],
  "exclusions": ["internship"],
  "skills": ["VMware", "Azure"],
  "notifyEnabled": true,
  "notifyThreshold": 75,
  "skillTarget": 5,
  "skillFamilyTarget": 4
}
```

**Response:** Same shape as GET, plus `rescored` count.

**Errors:**

- `400` if `salaryMin > salaryMax`
- `400` if arrays are not string arrays
- `400` if numeric settings out of range

### `POST /api/profile/test-notification`

Send a test Telegram message.

**Response:** `{ "ok": true }`

**Errors:**

- `400` if Telegram not configured
- `502` if Telegram API fails

---

## Applications

### `POST /api/applications/:jobId/draft`

Create a rule-based draft (no LLM). Selects relevant bullets by keyword overlap.

**Response:**

```json
{
  "id": "app123",
  "status": "drafted",
  "headline": "Your Name — VMware for Senior Engineer at Example Corp",
  "summary": "Your Name brings direct experience in ...",
  "bullets": ["Bullet text 1", "Bullet text 2"],
  "tailoring": null,
  "job": {
    "id": "job456",
    "title": "Senior Engineer",
    "company": "Example Corp",
    "url": "https://...",
    "location": "Remote"
  },
  "createdAt": "2026-08-19 12:00:00",
  "decidedAt": null
}
```

**Errors:** `404` if job not found

### `GET /api/applications/:jobId/tailoring-context`

Everything an agent needs to LLM-tailor an application.

**Response:**

```json
{
  "job": {
    "id": "job456",
    "title": "Senior Engineer",
    "company": "Example Corp",
    "location": "Remote",
    "description": "Full job description text..."
  },
  "candidateBrief": "## Skills\nVMware, Azure\n\n## Headline accomplishments\n- ...",
  "rules": "You tailor a real candidate's resume material...",
  "expectedShape": {
    "headline": "string — one line positioning...",
    "summary": "string — two or three sentences...",
    "bullets": "[{ sourceText, tailoredText, changed }] — the 4-6 most relevant...",
    "leadSkills": "string[] — candidate skills ordered by relevance...",
    "leadCertifications": "string[] — certifications ordered by relevance",
    "keywordGaps": "string[] — terms this posting wants that the candidate genuinely lacks",
    "coveredButUnstated": "string[] — terms the candidate evidences but never names literally",
    "fitAssessment": "string — one honest sentence, including reasons not to apply"
  }
}
```

### `POST /api/applications/:jobId/tailoring`

Save an agent-produced tailoring. Validated against `TailoredApplicationSchema`.

**Request body:**

```json
{
  "headline": "Senior Virtualization Engineer — 15+ Years VMware & DR",
  "summary": "Two or three sentences tailored to this posting.",
  "bullets": [
    {
      "sourceText": "Original bullet from profile",
      "tailoredText": "Rewritten bullet leading with posting vocabulary",
      "changed": true
    }
  ],
  "leadSkills": ["VMware", "Disaster Recovery"],
  "leadCertifications": ["VCP-DCV"],
  "keywordGaps": ["Kubernetes"],
  "coveredButUnstated": ["NSX"],
  "fitAssessment": "Strong fit for virtualization-focused role; gap in container orchestration."
}
```

**Response:** Same as draft endpoint, with `tailoring` populated.

**Errors:**

- `404` if job not found
- `400` with `{ error, issues }` if validation fails

### `GET /api/applications/:id`

Fetch an application by ID.

**Response:** Same shape as draft endpoint.

**Errors:** `404` if not found

### `GET /api/applications/:id/resume.docx`

Download tailored resume as Word document.

**Response:** Binary `.docx` file with `Content-Disposition: attachment`

**Errors:** `404` if application not found

### `POST /api/applications/:id/telegram`

Send the tailored `.docx` to configured Telegram chat.

**Response:**

```json
{
  "filename": "YourName_ExampleCorp_SeniorEngineer.docx",
  "bytes": 12345,
  "skipped": null
}
```

**Errors:**

- `404` if application not found
- `409` if skipped (`disabled` or `unconfigured`)
- `502` if Telegram API fails

### `POST /api/applications/:id/approve`

Mark application approved. Does **not** submit anywhere — returns updated application with posting URL available in `job.url`.

**Response:** Updated application object with `status: "approved"` and `decidedAt` set.

**Errors:** `404` if not found

---

## Documents

### `GET /api/documents`

List source resume/CV files from `server/data/documents/`.

**Response:**

```json
{
  "documents": [
    {
      "name": "MyResume.docx",
      "size": 45678,
      "modifiedAt": "2026-08-15T10:30:00.000Z"
    }
  ],
  "folder": "/path/to/server/data/documents"
}
```

### `GET /api/documents/:name`

Download or view a document inline.

**Response:** File bytes with appropriate `Content-Type`

Supported: `.pdf`, `.docx`, `.doc`, `.txt`, `.md`, `.rtf`

**Errors:** `404` if not found or path traversal attempted

---

## Audit

### `GET /api/audit`

Recent audit log entries (last 50).

**Response:**

```json
{
  "entries": [
    {
      "id": "audit123",
      "entity_type": "application",
      "entity_id": "app456",
      "action": "approved",
      "detail": null,
      "created_at": "2026-08-19 12:00:00"
    }
  ]
}
```

---

## Error format

Most errors return:

```json
{
  "error": "Human-readable message"
}
```

Validation errors may include:

```json
{
  "error": "tailoring does not match the expected shape",
  "issues": [ /* Zod issue objects */ ]
}
```

## HTTP status codes

| Code | Usage |
|------|-------|
| 200 | Success |
| 201 | Resource created (sources) |
| 400 | Invalid request |
| 404 | Resource not found |
| 409 | Conflict (e.g. Telegram skipped) |
| 502 | External service failure (Telegram) |
