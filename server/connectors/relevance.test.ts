import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, queryTerms, searchText, nullableSalary, stripHtml } from './relevance.js';
import { parseSalary } from './jooble.js';

describe('queryTerms', () => {
  test('drops stopwords so they are not required in the listing', () => {
    assert.deepEqual(queryTerms('Director of Infrastructure'), ['director', 'infrastructure']);
  });

  test('drops single characters, which match nearly everything', () => {
    assert.deepEqual(queryTerms('C engineer'), ['engineer']);
  });

  test('an all-stopword query yields no terms', () => {
    assert.deepEqual(queryTerms('the and of'), []);
  });
});

describe('matchesQuery', () => {
  test('requires every query term, not just one', () => {
    // Jobicy's own tag filter fails exactly here: "active directory" returned an SEO manager
    // because it matched on "active" alone.
    assert.equal(matchesQuery('Active Lifestyle SEO Manager', 'active directory'), false);
    assert.equal(matchesQuery('Senior Active Directory Engineer', 'active directory'), true);
  });

  test('matches whole words only', () => {
    // The substring bug this shares with util/text.ts: "storage" must not match "rag".
    assert.equal(matchesQuery('Storage Administrator', 'rag'), false);
    assert.equal(matchesQuery('RAG Pipeline Engineer', 'rag'), true);
  });

  test('is case insensitive', () => {
    assert.equal(matchesQuery('VMWARE ENGINEER', 'vmware'), true);
  });

  test('term order does not matter', () => {
    assert.equal(matchesQuery('Engineer, VMware Infrastructure', 'vmware engineer'), true);
  });

  test('an empty query matches everything', () => {
    assert.equal(matchesQuery('Anything at all', ''), true);
  });

  test('keeps terms that are not word characters matchable', () => {
    // Skills are user-editable, so "c++" and ".net" are reachable inputs, not hypotheticals.
    assert.equal(matchesQuery('Senior C++ Developer', 'c++'), true);
    assert.equal(matchesQuery('.NET Backend Engineer', '.net'), true);
  });
});

describe('searchText', () => {
  test('joins present fields and skips blanks', () => {
    assert.equal(searchText('Title', null, 'Tags', undefined, ''), 'Title Tags');
  });
});

describe('nullableSalary', () => {
  test('maps a board reporting 0 to unknown, not to zero pay', () => {
    // Remote OK sends salary_min: 0 for "not stated"; passing that through renders a "$0k" tag
    // and tells the matcher the job pays nothing.
    assert.equal(nullableSalary(0), null);
    assert.equal(nullableSalary(undefined), null);
    assert.equal(nullableSalary(null), null);
    assert.equal(nullableSalary(150000), 150000);
  });
});

describe('stripHtml', () => {
  test('removes tags', () => {
    assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  test('decodes entities before stripping, so escaped markup does not survive', () => {
    // Arbeitnow escapes its markup. Stripping first and decoding after reveals a fresh layer of
    // tags that the strip pass has already gone past, and they land in the stored description.
    assert.equal(stripHtml('&lt;div class="intro"&gt;About&lt;/div&gt;'), 'About');
  });

  test('decodes ampersands without corrupting adjacent entities', () => {
    assert.equal(stripHtml('Research &amp; Development'), 'Research & Development');
  });

  test('collapses whitespace left behind by removed tags', () => {
    assert.equal(stripHtml('<p>a</p>\n\n   <p>b</p>'), 'a b');
  });
});

describe('parseSalary — Jooble free-text salaries', () => {
  test('reads an annual range', () => {
    assert.deepEqual(parseSalary('$95,000 - $120,000 per year'), [95000, 120000]);
  });

  test('expands k notation', () => {
    assert.deepEqual(parseSalary('$140k - $190k'), [140000, 190000]);
  });

  test('rejects non-annual rates rather than mixing incomparable units', () => {
    // A day rate fed to a matcher calibrated against $140k-$190k scores every contract role as
    // far below minimum. Unknown is the honest answer.
    assert.deepEqual(parseSalary('£450 per day'), [null, null]);
    assert.deepEqual(parseSalary('$85 hourly'), [null, null]);
    assert.deepEqual(parseSalary('$8,000 per month'), [null, null]);
  });

  test('handles a missing or unparseable salary', () => {
    assert.deepEqual(parseSalary(undefined), [null, null]);
    assert.deepEqual(parseSalary(''), [null, null]);
    assert.deepEqual(parseSalary('Competitive'), [null, null]);
  });

  test('a single figure becomes a minimum with no maximum', () => {
    assert.deepEqual(parseSalary('From $120,000'), [120000, null]);
  });
});
