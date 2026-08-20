import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * db/index.ts opens DATABASE_PATH at import time and applies the schema, so the path has to be
 * redirected to a throwaway file BEFORE the module graph loads. ESM hoists static imports above
 * any statement, which is why telegram.js is pulled in dynamically below rather than at the top.
 */
let dir: string;
let telegram: typeof import('./telegram.js');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gighunter-test-'));
  process.env.DATABASE_PATH = join(dir, 'test.db');
  telegram = await import('./telegram.js');
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function match(overrides: Partial<import('./telegram.js').NotifiableMatch> = {}) {
  return {
    jobId: 'job-1',
    title: 'VMware Engineer',
    company: 'Acme',
    location: 'Remote',
    url: 'https://example.com/jobs/1',
    salaryMin: 140000,
    salaryMax: 190000,
    score: 88,
    applicationId: 'app-1',
    ...overrides,
  };
}

describe('publicBaseUrl', () => {
  test('defaults to the loopback address the server binds', () => {
    delete process.env.GIGHUNTER_PUBLIC_BASE_URL;
    assert.match(telegram.publicBaseUrl(), /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  test('honours an override so links can resolve from a phone', () => {
    process.env.GIGHUNTER_PUBLIC_BASE_URL = 'https://gighunter.example.ts.net';
    assert.equal(telegram.publicBaseUrl(), 'https://gighunter.example.ts.net');
    delete process.env.GIGHUNTER_PUBLIC_BASE_URL;
  });

  test('strips a trailing slash so the joined path has no double slash', () => {
    process.env.GIGHUNTER_PUBLIC_BASE_URL = 'https://example.com/';
    assert.equal(telegram.resumeUrl('abc'), 'https://example.com/api/applications/abc/resume.docx');
    delete process.env.GIGHUNTER_PUBLIC_BASE_URL;
  });
});

describe('formatDigest', () => {
  test('includes a resume link for a drafted match', () => {
    const text = telegram.formatDigest([match()]);
    assert.ok(text.includes('/api/applications/app-1/resume.docx'), text);
    assert.ok(text.includes('📄 Resume:'), text);
  });

  test('omits the resume line rather than emitting a dead link', () => {
    // applicationId is null only when drafting threw. An entry carrying a link to nothing is
    // worse than an entry with no link.
    const text = telegram.formatDigest([match({ applicationId: null })]);
    assert.ok(!text.includes('Resume:'), text);
    assert.ok(text.includes('VMware Engineer'), text);
  });

  test('still carries the posting URL alongside the resume link', () => {
    const text = telegram.formatDigest([match()]);
    assert.ok(text.includes('https://example.com/jobs/1'), text);
  });

  test('stays under the Telegram message limit when every entry has a resume link', () => {
    // The resume line lengthened every entry; the 4096-char ceiling is what a failed send would
    // hit, and a failed send leaves notified_at unset and retries forever.
    const many = Array.from({ length: 40 }, (_, i) =>
      match({
        jobId: `job-${i}`,
        applicationId: `application-${i}`,
        title: `Senior Infrastructure and Virtualization Engineer number ${i}`,
        company: `A Company With A Fairly Long Name ${i}`,
      })
    );
    const text = telegram.formatDigest(many);
    assert.ok(text.length <= 4096, `digest was ${text.length} chars`);
    assert.match(text, /and \d+ more/);
  });

  test('reports the singular for one match', () => {
    assert.ok(telegram.formatDigest([match()]).includes('1 strong match'));
  });
});
