import { containsWholeWord } from '../util/text.js';

/**
 * Client-side relevance filtering for boards that cannot search.
 *
 * Every v1 connector maps a source's `query` onto a server-side search parameter. Four of the
 * Phase 2 boards cannot honour that contract:
 *
 *   - Remote OK accepts `?tag=` and silently ignores it. All tags return the identical 101-item
 *     feed; `tag=golang` came back leading with "General Cleaner Caribe Hilton".
 *   - Arbeitnow's job-board API takes no query parameter at all — it is a paginated firehose,
 *     mostly German-language listings.
 *   - The Muse has no free-text parameter. It filters by `category`, which narrows 408k listings
 *     to ~1.5k for "Computer and IT" but says nothing about the actual search term.
 *   - Jobicy accepts `tag=` but matches so loosely it is not usable alone: `tag=vmware` returned
 *     a Technical Product Marketer, and `tag=active directory` returned an SEO manager.
 *
 * So those connectors fetch what the board will give them and filter here. This is why their
 * `search` capability flag reads false — the pipeline should know the filtering is ours, not
 * theirs. The alternative, ingesting the raw feed, would put thousands of irrelevant rows through
 * the matcher and into the dashboard.
 */

/**
 * Words carrying no discriminating power in a job search. Dropped from the query so
 * "Director of Infrastructure" is not required to contain the literal word "of".
 */
const STOPWORDS = new Set(['a', 'an', 'and', 'the', 'of', 'or', 'for', 'in', 'to', 'with']);

/** Splits a query into the terms a listing must contain. Multi-word queries are ANDed. */
export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length > 1 && !STOPWORDS.has(term));
}

/**
 * True when every meaningful term in the query appears as a whole word in `haystack`.
 *
 * Callers pass the listing's title plus its tag/category metadata — deliberately NOT the body of
 * the job description. Matching the full description is what a first implementation does and it
 * does not work: on a live run "engineer" matched a Fire Fighter posting and "security" matched
 * an AV Support Coordinator, because a long JD mentions those words somewhere almost every time.
 * A job board's own search weights the title, and so does this.
 *
 * AND rather than OR across terms: a single-term hit on a two-word query is exactly what makes
 * Jobicy's own tag filter unusable ("active directory" matching anything merely "active").
 * Whole-word matching comes from util/text.ts for the reason documented there — plain substring
 * matching scored "storage" as a RAG match across 47 postings.
 *
 * An empty query matches everything; that is the honest reading of "no filter requested", and
 * source creation already rejects a blank input before it reaches a connector.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;
  return terms.every(term => containsWholeWord(haystack, term));
}

/** Joins a listing's searchable fields, skipping the blanks, into one haystack. */
export function searchText(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Boards report "no salary" as 0; the matcher expects null, and 0 renders as a "$0k" tag. */
export function nullableSalary(value: number | null | undefined): number | null {
  return value != null && value > 0 ? value : null;
}

/**
 * Flattens a board's HTML description to plain text.
 *
 * Entities are decoded BEFORE tags are stripped, and the strip runs after. Doing it the other way
 * round is a real bug: Arbeitnow double-escapes its markup, so decoding after stripping *reveals*
 * a fresh layer of `<div>`/`<h2>` tags that the strip pass has already gone past, and they land
 * verbatim in the stored description.
 */
export function stripHtml(value: string): string {
  const decoded = value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    // &amp; last: decoding it first would turn "&amp;lt;" into "&lt;" and then into "<", inventing
    // markup that was never in the source. Doing it last means a doubly-escaped entity decodes one
    // level and stops there — it survives as the literal text "&lt;", which is correct, since one
    // level of escaping is exactly what the publisher asked to be displayed. Verified against 12
    // stored Arbeitnow descriptions: no double-escaped entities and no leftover markup.
    .replace(/&amp;/g, '&');

  return decoded
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
