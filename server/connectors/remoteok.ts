import type { NormalizedListing } from '../db/types.js';
import { matchesQuery, nullableSalary, searchText, stripHtml } from './relevance.js';

const USER_AGENT = 'Gighunter/0.1 (+local job search assistant)';

interface RemoteOkJob {
  id?: string;
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  tags?: string[];
  url?: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
  date?: string;
}

/** The first element of the feed is a legal/attribution notice, not a job. */
interface RemoteOkLegal {
  legal?: string;
}

/**
 * Public, keyless Remote OK feed.
 *
 * Remote OK accepts `?tag=` but does not act on it — see relevance.ts — so this pulls the whole
 * feed (~100 current listings) and filters locally. That also means cadence matters more here
 * than for a searchable board: the feed only ever holds the most recent listings, so a long
 * poll interval silently misses postings that scrolled off.
 *
 * Configure this source with SINGLE broad terms ("security", "engineer"), not phrases. Against a
 * searchable board "Security Engineer" is a reasonable query; here it is an AND over two words
 * applied to 100 rotating listings, and on a live feed it matched zero of them while "engineer"
 * alone matched nine. The scorer is what narrows Remote OK results, not the query.
 *
 * Attribution: Remote OK's API terms require crediting Remote OK as the source and linking back.
 * Gighunter stores their canonical `url` and only ever opens it for the candidate to apply, which
 * satisfies that; do not re-host these listings anywhere else.
 */
export async function fetchRemoteOk(query: string): Promise<NormalizedListing[]> {
  const res = await fetch('https://remoteok.com/api', { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Remote OK request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as (RemoteOkJob & RemoteOkLegal)[];
  if (!Array.isArray(data)) throw new Error('Remote OK returned an unexpected payload');

  return data
    // Drop the legal notice and anything else lacking the fields that make a row a job.
    .filter(entry => !entry.legal && entry.position && (entry.url || entry.apply_url))
    // Title and company only. Remote OK's tags are not usable as a relevance signal: on a live
    // feed "General Cleaner Caribe Hilton" carried the tags 'golang' and 'infosec', "Fire Fighter"
    // carried 'engineer', and 34 of 100 listings were tagged 'engineer' regardless of role. They
    // are still stored in the description, where the scorer weighs them against everything else,
    // but letting them qualify a listing here admits obvious non-matches.
    .filter(job => matchesQuery(searchText(job.position, job.company), query))
    .map(job => ({
      externalId: job.id ?? job.slug ?? null,
      title: job.position!,
      company: job.company ?? 'Unknown company',
      location: job.location?.trim() || 'Remote',
      // Tags are joined into the description so the relevance filter can see them: Remote OK's
      // titles are terse ("All Other Roles") and the tags often carry the only technology terms.
      description: [job.description ? stripHtml(job.description) : null, job.tags?.join(', ')]
        .filter(Boolean)
        .join('\n\n') || null,
      url: job.url ?? job.apply_url!,
      salaryMin: nullableSalary(job.salary_min),
      salaryMax: nullableSalary(job.salary_max),
      postedAt: job.date ?? null,
    }));
}
