/**
 * Scoring tests.
 *
 * scoreJob decides which of ~900 postings the candidate ever sees, so a silent regression here
 * is invisible by construction: you never learn about the match that was filtered out. These
 * pin the behaviour that matters and the substring bug that shipped undetected.
 *
 * match.ts imports db/index.js, which opens SQLite on import. DATABASE_PATH is redirected to a
 * throwaway file before that import so the suite never touches the real database. env.ts only
 * fills in variables that are unset, so setting it here wins.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'orbit-test-')), 'test.db');

const { scoreJob } = await import('./match.js');
const { containsWholeWord } = await import('../util/text.js');
const { db } = await import('../db/index.js');

after(() => db.close());

type Candidate = Parameters<typeof scoreJob>[1];
type JobRow = Parameters<typeof scoreJob>[0];

const TARGETS = { skillTarget: 4, skillFamilyTarget: 4 };

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'test-candidate',
    name: 'Test Candidate',
    headline: null,
    skills: ['VMware', 'Active Directory', 'PowerShell', 'Azure'],
    salaryMin: 120_000,
    salaryMax: 180_000,
    locations: ['Remote'],
    exclusions: [],
    resumeBullets: [],
    email: null,
    phone: null,
    linkedin: null,
    homeLocation: null,
    certifications: [],
    education: [],
    workHistory: [],
    additionalExperience: [],
    ...overrides,
  } as Candidate;
}

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'test-job',
    title: 'Systems Engineer',
    company: 'Test Co',
    location: 'Remote',
    description: '',
    url: 'https://example.com/job',
    salary_min: 140_000,
    salary_max: 170_000,
    ...overrides,
  } as JobRow;
}

describe('containsWholeWord', () => {
  it('does not match a term inside a longer word', () => {
    // The bug this suite exists for: "storage" contains "rag".
    assert.equal(containsWholeWord('enterprise storage engineer', 'rag'), false);
    assert.equal(containsWholeWord('paragraph', 'rag'), false);
    assert.equal(containsWholeWord('international assignments', 'intern'), false);
  });

  it('matches a standalone term', () => {
    assert.equal(containsWholeWord('experience building RAG pipelines', 'rag'), true);
    assert.equal(containsWholeWord('hiring an intern', 'intern'), true);
  });

  it('matches multi-word terms', () => {
    assert.equal(containsWholeWord('deploys site recovery manager daily', 'site recovery manager'), true);
  });

  it('handles terms whose edges are not word characters', () => {
    // \b between two non-word characters never matches, so anchoring both sides would make
    // these unmatchable. Skills are user-editable, so this case is reachable.
    assert.equal(containsWholeWord('strong c++ background', 'c++'), true);
    assert.equal(containsWholeWord('built on .net core', '.net'), true);
  });
});

describe('scoreJob — skill matching', () => {
  it('does not credit an AI domain match for a storage posting', () => {
    // Regression: "storage" contains "rag", which counted toward the ai family. 47 of 895 real
    // postings mention storage; only 16 mention RAG.
    const result = scoreJob(
      job({
        title: 'Storage Engineer',
        description: 'Manage enterprise storage arrays. Paragraph after paragraph of storage.',
      }),
      candidate({ skills: [] }),
      TARGETS
    );
    assert.ok(
      !result.rationale.toLowerCase().includes('ai skills'),
      `storage posting should not match the ai family, got: ${result.rationale}`
    );
  });

  it('credits a genuine domain match', () => {
    const result = scoreJob(
      job({
        title: 'Virtualization Engineer',
        description: 'vSphere, ESXi, vCenter and NSX administration across the estate.',
      }),
      candidate({ skills: [] }),
      TARGETS
    );
    assert.match(result.rationale, /virtualization skills matched/);
    assert.ok(result.score >= 60, `expected a full domain match to carry the 60-point band, got ${result.score}`);
  });

  it('uses whichever of flat skills or family match fits the posting better', () => {
    const flatOnly = scoreJob(
      job({ title: 'IT Generalist', description: 'PowerShell and Azure scripting; some Active Directory.' }),
      candidate(),
      TARGETS
    );
    assert.ok(flatOnly.score > 0, 'flat profile skills should still score when no family dominates');
  });
});

describe('scoreJob — weighting', () => {
  it('vetoes to zero on an exclusion regardless of fit', () => {
    const result = scoreJob(
      job({ title: 'VMware Engineer', description: 'vSphere ESXi vCenter NSX' }),
      candidate({ exclusions: ['unpaid'] , skills: [] }),
      TARGETS
    );
    assert.ok(result.score > 0, 'sanity: this posting scores without the exclusion');

    const excluded = scoreJob(
      job({ title: 'VMware Engineer', description: 'vSphere ESXi vCenter NSX. This is an unpaid internship.' }),
      candidate({ exclusions: ['unpaid'], skills: [] }),
      TARGETS
    );
    assert.equal(excluded.score, 0);
    assert.equal(excluded.excluded, true);
  });

  it('awards salary points only when the ranges overlap', () => {
    const overlapping = scoreJob(job({ salary_min: 150_000, salary_max: 160_000 }), candidate(), TARGETS);
    const below = scoreJob(job({ salary_min: 40_000, salary_max: 60_000 }), candidate(), TARGETS);
    assert.equal(overlapping.score - below.score, 25, 'salary band is worth 25 points');
  });

  it('awards location points only for a target location', () => {
    const remote = scoreJob(job({ location: 'Remote (United States)' }), candidate(), TARGETS);
    const onsite = scoreJob(job({ location: 'Dublin, Ireland' }), candidate(), TARGETS);
    assert.equal(remote.score - onsite.score, 15, 'location band is worth 15 points');
  });

  it('never returns a score outside 0-100', () => {
    const perfect = scoreJob(
      job({
        title: 'VMware Virtualization Engineer',
        description: 'vSphere ESXi vCenter NSX vRealize hypervisor VDI. Active Directory. PowerShell. Azure.',
        location: 'Remote',
        salary_min: 150_000,
        salary_max: 175_000,
      }),
      candidate(),
      TARGETS
    );
    assert.ok(perfect.score <= 100 && perfect.score >= 0, `got ${perfect.score}`);
  });
});
