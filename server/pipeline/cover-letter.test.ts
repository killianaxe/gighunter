import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { resolveCoverLetter, salutation, templateCoverLetter } from './cover-letter.js';
import { checkCoverLetterLength, type CoverLetter } from '../llm/tailor.js';
import type { ApplicationRow, Candidate, JobRow } from '../db/types.js';

const candidate: Candidate = {
  id: 'c1',
  name: 'Ada Lovelace',
  headline: 'Senior Systems Engineer — Cloud Security | Virtualization',
  skills: ['Microsoft Entra ID', 'VMware vSphere', 'Kubernetes'],
  salaryMin: null,
  salaryMax: null,
  locations: [],
  exclusions: [],
  resumeBullets: [
    { text: 'Migrated 49 users to Microsoft Entra ID with a 98% completion rate.', keywords: ['entra'] },
    { text: 'Ran a VMware vSphere estate of 2,500+ virtual machines.', keywords: ['vsphere'] },
    {
      // Deliberately over the letter's word ceiling: a fine resume bullet, a bad letter sentence.
      text: `Consolidated ${'legacy infrastructure across many sites '.repeat(10)}without downtime.`,
      keywords: ['entra'],
    },
  ],
  email: 'ada@example.com',
  phone: '555-0100',
  linkedin: null,
  homeLocation: 'London',
  certifications: [],
  education: [],
  workHistory: [],
  additionalExperience: [],
};

const job = (overrides: Partial<JobRow> = {}): JobRow =>
  ({
    id: 'j1',
    source_id: 's1',
    external_id: null,
    title: 'Identity Engineer',
    company: 'Acme',
    location: 'Remote (United States)',
    description: 'We need Entra ID and vSphere experience.',
    url: 'https://example.com/j1',
    salary_min: null,
    salary_max: null,
    posted_at: null,
    normalized_key: 'k',
    created_at: '2026-01-01',
    ...overrides,
  }) as JobRow;

const application = (tailoringJson: string | null): ApplicationRow =>
  ({
    id: 'a1',
    job_id: 'j1',
    candidate_id: 'c1',
    status: 'drafted',
    draft_headline: null,
    draft_summary: null,
    draft_bullets_json: '[]',
    tailoring_json: tailoringJson,
    resume_sent_at: null,
    created_at: '2026-01-01',
    decided_at: null,
  }) as ApplicationRow;

const validLetter: CoverLetter = {
  recipient: null,
  opening: 'word '.repeat(50),
  fitParagraph: 'word '.repeat(50),
  interestParagraph: 'word '.repeat(50),
  closingParagraph: 'word '.repeat(50),
};

describe('salutation', () => {
  it('falls back to Dear Hiring Manager rather than To Whom It May Concern', () => {
    for (const empty of [null, undefined, '', '   ']) {
      assert.equal(salutation(empty), 'Dear Hiring Manager,');
    }
  });

  it('uses a supplied name', () => {
    assert.equal(salutation('Ms. Rivera'), 'Dear Ms. Rivera,');
  });

  it('normalises an over-filled recipient field into one well-formed greeting', () => {
    // The model is told to send only a name, but a stray "Dear" or comma must not produce
    // "Dear Dear Ms. Rivera,," in a document going to an employer.
    assert.equal(salutation('Dear Ms. Rivera,'), 'Dear Ms. Rivera,');
    assert.equal(salutation('ms. rivera:'), 'Dear ms. rivera,');
  });
});

describe('templateCoverLetter', () => {
  it('composes the resume headline into a real sentence', () => {
    const letter = templateCoverLetter(job(), candidate);
    assert.match(letter.opening, /I am a Senior Systems Engineer working across Cloud Security and Virtualization\./);
  });

  it('names the exact role and company', () => {
    const letter = templateCoverLetter(job(), candidate);
    assert.match(letter.opening, /Identity Engineer position at Acme/);
  });

  it('quotes only the candidate\'s own bullets, never invented achievements', () => {
    const letter = templateCoverLetter(job(), candidate);
    const claims = letter.fitParagraph.replace('Work from my recent roles that bears on this one: ', '');
    for (const claim of claims.split(/(?<=\.)\s+/).filter(Boolean)) {
      const source = claim.replace(/\.$/, '');
      assert.ok(
        candidate.resumeBullets.some(bullet => bullet.text.includes(source)),
        `letter claim not found in candidate material: ${claim}`
      );
    }
  });

  it('leaves over-long resume bullets out of the letter', () => {
    const letter = templateCoverLetter(job(), candidate);
    assert.ok(!letter.fitParagraph.includes('legacy infrastructure'));
  });

  it('never guesses a recipient', () => {
    assert.equal(templateCoverLetter(job(), candidate).recipient, null);
  });

  it('degrades to a usable letter when nothing matches the posting', () => {
    const unrelated = job({ title: 'Pastry Chef', description: 'Croissants.' });
    const letter = templateCoverLetter(unrelated, candidate);
    assert.match(letter.opening, /Pastry Chef position at Acme/);
    assert.ok(letter.fitParagraph.length > 0);
  });
});

describe('resolveCoverLetter', () => {
  it('prefers a stored tailored letter', () => {
    const stored = { coverLetter: { ...validLetter, opening: 'Tailored opening.' } };
    const { letter, source } = resolveCoverLetter(application(JSON.stringify(stored)), job(), candidate);
    assert.equal(source, 'tailored');
    assert.equal(letter.opening, 'Tailored opening.');
  });

  it('falls back for tailorings written before cover letters existed', () => {
    // Rows already in the database have a tailoring but no coverLetter key.
    const legacy = JSON.stringify({ headline: 'h', summary: 's', bullets: [] });
    assert.equal(resolveCoverLetter(application(legacy), job(), candidate).source, 'template');
  });

  it('falls back on a partially written letter rather than rendering a gap', () => {
    const partial = JSON.stringify({ coverLetter: { recipient: null, opening: 'Only this.' } });
    assert.equal(resolveCoverLetter(application(partial), job(), candidate).source, 'template');
  });

  it('falls back on corrupt JSON instead of failing the download', () => {
    assert.equal(resolveCoverLetter(application('{not json'), job(), candidate).source, 'template');
  });
});

describe('checkCoverLetterLength', () => {
  it('accepts a one-page letter', () => {
    assert.equal(checkCoverLetterLength(validLetter), null);
  });

  it('rejects a stub', () => {
    const stub = { ...validLetter, opening: 'Hi.', fitParagraph: 'I did things.', interestParagraph: 'Nice.', closingParagraph: 'Bye.' };
    assert.match(checkCoverLetterLength(stub)!, /only \d+ words/);
  });

  it('rejects a letter that would run past one page', () => {
    const bloated = { ...validLetter, fitParagraph: 'word '.repeat(400) };
    assert.match(checkCoverLetterLength(bloated)!, /must fit one page/);
  });
});
