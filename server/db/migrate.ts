import type Database from 'better-sqlite3';

/**
 * The original `sources.type` column had a CHECK(type IN ('remotive','rss')) baked into
 * existing database files. schema.sql no longer defines that constraint (type validity now
 * lives in the SOURCE_TYPES allowlist), but CREATE TABLE IF NOT EXISTS can't lift a
 * constraint from a table that already exists — so rebuild it once, preserving rows/ids.
 */
export function migrateSourcesTable(db: Database.Database): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='sources'`).get() as
    | { sql: string }
    | undefined;

  if (!row || !row.sql.includes('CHECK')) return;

  db.pragma('foreign_keys = OFF');
  try {
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE sources_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          query_or_url TEXT NOT NULL,
          cadence_minutes INTEGER NOT NULL DEFAULT 120,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_polled_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO sources_new (id, name, type, query_or_url, cadence_minutes, enabled, last_polled_at, created_at)
          SELECT id, name, type, query_or_url, cadence_minutes, enabled, last_polled_at, created_at FROM sources;
        DROP TABLE sources;
        ALTER TABLE sources_new RENAME TO sources;
      `);
    });
    rebuild();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

const CANDIDATE_COLUMNS: Record<string, string> = {
  headline: 'TEXT',
  email: 'TEXT',
  phone: 'TEXT',
  linkedin: 'TEXT',
  home_location: 'TEXT',
  certifications_json: `TEXT NOT NULL DEFAULT '[]'`,
  education_json: `TEXT NOT NULL DEFAULT '[]'`,
  work_history_json: `TEXT NOT NULL DEFAULT '[]'`,
  additional_experience_json: `TEXT NOT NULL DEFAULT '[]'`,
};

/** Adds the resume-detail columns (email/phone/linkedin/work history/etc) to existing candidates tables. */
export function migrateCandidatesColumns(db: Database.Database): void {
  const existing = new Set((db.prepare(`PRAGMA table_info(candidates)`).all() as { name: string }[]).map(c => c.name));

  for (const [column, definition] of Object.entries(CANDIDATE_COLUMNS)) {
    if (!existing.has(column)) {
      db.exec(`ALTER TABLE candidates ADD COLUMN ${column} ${definition}`);
    }
  }
}

/**
 * Adds jobs.notified_at to existing databases. New tables are handled by schema.sql's
 * CREATE TABLE IF NOT EXISTS, but that statement is a no-op against an existing table,
 * so added columns always need an explicit ALTER here.
 *
 * Backfilled to datetime('now') for every job already on file: those predate the notifier,
 * and announcing a few hundred historical matches on first launch would be worse than useless.
 */
export function migrateJobsColumns(db: Database.Database): void {
  const existing = new Set((db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[]).map(c => c.name));
  if (existing.has('notified_at')) return;

  db.exec(`ALTER TABLE jobs ADD COLUMN notified_at TEXT`);
  db.exec(`UPDATE jobs SET notified_at = datetime('now')`);
}

/**
 * Adds applications.tailoring_json for the full tailoring result — keyword gaps, the
 * covered-but-unstated list, and the fit assessment have no home in the three draft_* columns,
 * and they are the fields worth reading before deciding whether to apply.
 */
export function migrateApplicationsColumns(db: Database.Database): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(applications)`).all() as { name: string }[]).map(c => c.name)
  );
  if (!existing.has('tailoring_json')) {
    db.exec('ALTER TABLE applications ADD COLUMN tailoring_json TEXT');
  }
  /**
   * When the tailored .docx was last pushed to Telegram.
   *
   * The auto-scheduler used to treat "has no application row" as "resume not delivered". That
   * held only while drafting and delivering happened together. The notifier now drafts every
   * announced match so the digest can link a resume that exists, which makes every strong match
   * look drafted and would leave the scheduler with nothing to do — silently ending mobile
   * resume delivery. Delivery is therefore tracked on its own rather than inferred.
   *
   * Existing rows backfill to NULL, i.e. "not delivered". That is the safe direction: the worst
   * case is one catch-up send, whereas backfilling as sent would drop resumes on the floor.
   */
  if (!existing.has('resume_sent_at')) {
    db.exec('ALTER TABLE applications ADD COLUMN resume_sent_at TEXT');
  }

  /**
   * Backfill delivery times from the audit log, which has recorded every successful send all
   * along. Runs unconditionally rather than only when the column is created: an earlier boot can
   * add the column before this backfill exists, and gating on the ALTER would then skip it
   * permanently, leaving the scheduler to re-send the whole history as duplicate documents.
   *
   * It is idempotent by construction — it only fills rows that are still NULL, and only from
   * evidence that a send actually happened. logAudit writes the detail as `${title} — ${company}`,
   * so the same concatenation reconstructs the key. Matching on that pair rather than on the
   * stored filename avoids depending on how resumeFilename sanitises company names, which has no
   * inverse.
   */
  db.exec(`
    UPDATE applications SET resume_sent_at = (
      SELECT MAX(al.created_at) FROM audit_log al
      JOIN jobs j ON j.id = applications.job_id
      WHERE al.action = 'telegram_resume_sent'
        AND al.detail = j.title || ' — ' || j.company
    )
    WHERE resume_sent_at IS NULL
  `);
}
