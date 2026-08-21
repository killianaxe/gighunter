CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  headline TEXT,
  skills_json TEXT NOT NULL DEFAULT '[]',
  salary_min INTEGER,
  salary_max INTEGER,
  locations_json TEXT NOT NULL DEFAULT '[]',
  exclusions_json TEXT NOT NULL DEFAULT '[]',
  resume_bullets_json TEXT NOT NULL DEFAULT '[]',
  email TEXT,
  phone TEXT,
  linkedin TEXT,
  home_location TEXT,
  certifications_json TEXT NOT NULL DEFAULT '[]',
  education_json TEXT NOT NULL DEFAULT '[]',
  work_history_json TEXT NOT NULL DEFAULT '[]',
  additional_experience_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  query_or_url TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL DEFAULT 120,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_polled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  description TEXT,
  url TEXT NOT NULL,
  salary_min INTEGER,
  salary_max INTEGER,
  posted_at TEXT,
  normalized_key TEXT NOT NULL UNIQUE,
  -- Set once a job has been announced by the notifier. Deliberately on jobs, not matches:
  -- rescoreAll() deletes and rebuilds every match row, which would clear the flag and
  -- re-announce the entire backlog on the next scan.
  notified_at TEXT,
  -- Set when the candidate dismisses the posting; NULL means still in play. On jobs for the same
  -- reason notified_at is: rescoreAll() rebuilds every match row, so a flag kept there would be
  -- erased and the dismissed posting would quietly reappear.
  dismissed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  score INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(job_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  status TEXT NOT NULL CHECK(status IN ('drafted','approved')) DEFAULT 'drafted',
  draft_headline TEXT,
  draft_summary TEXT,
  draft_bullets_json TEXT NOT NULL DEFAULT '[]',
  tailoring_json TEXT,
  -- When the tailored .docx was last delivered to Telegram; see migrate.ts.
  resume_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  UNIQUE(job_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Key/value app settings (notifier config). Unlike `candidates`, these describe how Gighunter
-- behaves rather than who the candidate is, so they get their own table.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_matches_candidate ON matches(candidate_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_applications_candidate ON applications(candidate_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
