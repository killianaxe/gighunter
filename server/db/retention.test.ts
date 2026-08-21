import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateJobsColumns } from './migrate.js';

/**
 * Retention's SQL is exercised against a throwaway in-memory database rather than the module's
 * own prepared statements, which bind to the real db at import time. What is under test is the
 * behaviour that matters: children before parents, and never touch a job with an application.
 */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE jobs (id TEXT PRIMARY KEY, title TEXT, notified_at TEXT,
                       created_at TEXT NOT NULL);
    CREATE TABLE matches (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id));
    CREATE TABLE applications (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id));
  `);
  return db;
}

function seed(db: Database.Database, id: string, ageDays: number, withApplication = false): void {
  db.prepare(`INSERT INTO jobs (id, title, created_at) VALUES (?, ?, datetime('now', ?))`).run(
    id,
    `job ${id}`,
    `-${ageDays} days`
  );
  db.prepare(`INSERT INTO matches (id, job_id) VALUES (?, ?)`).run(`m-${id}`, id);
  if (withApplication) {
    db.prepare(`INSERT INTO applications (id, job_id) VALUES (?, ?)`).run(`a-${id}`, id);
  }
}

const PRUNABLE = `
  SELECT j.id FROM jobs j
  WHERE j.created_at < datetime('now', ?)
    AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)
`;

describe('pruneOldJobs selection', () => {
  it('never selects a job that has an application, however old', () => {
    const db = makeDb();
    seed(db, 'ancient-applied', 400, true);
    seed(db, 'ancient-untouched', 400);
    const ids = (db.prepare(PRUNABLE).all('-60 days') as { id: string }[]).map(r => r.id);
    assert.deepEqual(ids, ['ancient-untouched']);
  });

  it('leaves anything inside the window alone', () => {
    const db = makeDb();
    seed(db, 'fresh', 3);
    seed(db, 'old', 90);
    const ids = (db.prepare(PRUNABLE).all('-60 days') as { id: string }[]).map(r => r.id);
    assert.deepEqual(ids, ['old']);
  });

  it('deleting a job before its matches violates the foreign key', () => {
    // This is why the prune deletes children first — the constraint is real, not theoretical.
    const db = makeDb();
    seed(db, 'x', 90);
    assert.throws(() => db.prepare(`DELETE FROM jobs WHERE id = ?`).run('x'), /FOREIGN KEY/);
    db.prepare(`DELETE FROM matches WHERE job_id = ?`).run('x');
    assert.doesNotThrow(() => db.prepare(`DELETE FROM jobs WHERE id = ?`).run('x'));
  });
});

describe('migrateJobsColumns', () => {
  it('adds dismissed_at to a database that already has notified_at', () => {
    // The regression this guards: the migration used to early-return once notified_at existed,
    // so every already-booted database would silently skip every column added afterwards.
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, notified_at TEXT, created_at TEXT)`);

    migrateJobsColumns(db);

    const columns = new Set((db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[]).map(c => c.name));
    assert.ok(columns.has('dismissed_at'), 'dismissed_at was not added to an existing database');
  });

  it('is idempotent across repeated boots', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT)`);
    migrateJobsColumns(db);
    assert.doesNotThrow(() => migrateJobsColumns(db));
    assert.doesNotThrow(() => migrateJobsColumns(db));
  });

  it('backfills notified_at but leaves dismissed_at null', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT)`);
    db.prepare(`INSERT INTO jobs (id, created_at) VALUES ('j1', datetime('now'))`).run();

    migrateJobsColumns(db);

    const row = db.prepare(`SELECT notified_at, dismissed_at FROM jobs WHERE id = 'j1'`).get() as {
      notified_at: string | null;
      dismissed_at: string | null;
    };
    assert.ok(row.notified_at, 'existing jobs should not be re-announced');
    assert.equal(row.dismissed_at, null, 'nothing is dismissed retroactively');
  });
});
