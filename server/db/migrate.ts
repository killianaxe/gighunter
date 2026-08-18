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
