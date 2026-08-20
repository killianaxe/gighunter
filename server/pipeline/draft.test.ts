import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** db/index.ts opens DATABASE_PATH at import, so redirect it before the module graph loads. */
let dir: string;
let db: import('better-sqlite3').Database;
let draftApplication: typeof import('./draft.js').draftApplication;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gighunter-draft-'));
  process.env.DATABASE_PATH = join(dir, 'test.db');
  ({ db } = await import('../db/index.js'));
  ({ draftApplication } = await import('./draft.js'));
});

after(() => rmSync(dir, { recursive: true, force: true }));

function seed() {
  db.prepare(
    `INSERT INTO candidates (id, name, skills_json, locations_json, exclusions_json, resume_bullets_json,
       certifications_json, education_json, work_history_json, additional_experience_json)
     VALUES ('cand-1','Test User','["vmware"]','["Remote"]','[]',
       '[{"text":"Ran a VMware estate","keywords":["vmware"]}]','[]','[]','[]','[]')`
  ).run();
  db.prepare(
    `INSERT INTO sources (id, name, type, query_or_url) VALUES ('src-1','s','remotive','vmware')`
  ).run();
  db.prepare(
    `INSERT INTO jobs (id, source_id, title, company, url, normalized_key, description)
     VALUES ('job-1','src-1','VMware Engineer','Acme','https://e.com/1','vmware engineer::acme','VMware role')`
  ).run();
}

describe('draftApplication — overwrite semantics', () => {
  before(() => seed());

  test('re-drafting overwrites a stored tailored summary', () => {
    // This is why auto/src/scheduler.ts must not re-draft an application that already exists.
    // orbit_save_tailoring writes the tailored summary into draft_summary, and the .docx renders
    // draft_summary — so a second draftApplication call silently replaces real tailoring with the
    // mechanical keyword template. Pinning the behaviour here so the hazard cannot be forgotten.
    const candidate = {
      id: 'cand-1',
      name: 'Test User',
      headline: null,
      skills: ['vmware'],
      salaryMin: null,
      salaryMax: null,
      locations: ['Remote'],
      exclusions: [],
      resumeBullets: [{ text: 'Ran a VMware estate', keywords: ['vmware'] }],
      email: null,
      phone: null,
      linkedin: null,
      homeLocation: null,
      certifications: [],
      education: [],
      workHistory: [],
      additionalExperience: [],
    };
    const job = db.prepare(`SELECT * FROM jobs WHERE id = 'job-1'`).get() as never;

    const first = draftApplication(job, candidate);
    db.prepare(`UPDATE applications SET draft_summary = ?, tailoring_json = ? WHERE id = ?`).run(
      'A genuinely tailored summary written by an agent.',
      JSON.stringify({ headline: 'tailored' }),
      first.id
    );

    const second = draftApplication(job, candidate);

    assert.equal(second.id, first.id, 'upsert should reuse the row, not create a second');
    assert.notEqual(
      second.draft_summary,
      'A genuinely tailored summary written by an agent.',
      'draft_summary is overwritten by a re-draft — the scheduler must not call this on an existing application'
    );
    assert.ok(second.tailoring_json, 'tailoring_json itself survives, which is what makes the loss silent');
  });
});
