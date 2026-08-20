import type { NormalizedListing } from '../db/types.js';
import { matchesQuery, searchText, stripHtml } from './relevance.js';

const USER_AGENT = 'Gighunter/0.1 (+local job search assistant)';

/** Pages are 20 listings each; ten covers most of the "Computer and IT" category. */
const MAX_PAGES = 10;

/**
 * The Muse has no free-text search, but it does filter by category — and that is what makes it
 * usable at all. Unfiltered the board is 408,793 listings across 20,440 pages; constrained to
 * these two categories it is about 1,700. Overridable per-install via MUSE_CATEGORIES.
 */
const DEFAULT_CATEGORIES = ['Computer and IT', 'IT'];

interface MuseJob {
  id?: number;
  name?: string;
  contents?: string;
  publication_date?: string;
  short_name?: string;
  company?: { name?: string };
  locations?: { name?: string }[];
  categories?: { name?: string }[];
  levels?: { name?: string }[];
  refs?: { landing_page?: string };
}

interface MuseResponse {
  results?: MuseJob[];
  page_count?: number;
}

/**
 * The Muse public jobs API. Keyless, but an optional MUSE_API_KEY raises the rate limit
 * (unauthenticated callers get roughly 500 requests/hour).
 *
 * Two constraints shape this connector. There is no query parameter, so the search term is
 * applied locally (see relevance.ts). And there are no salary fields anywhere in the payload,
 * so every listing scores on skills and location alone.
 */
export async function fetchTheMuse(query: string): Promise<NormalizedListing[]> {
  const apiKey = process.env.MUSE_API_KEY;
  const categories = (process.env.MUSE_CATEGORIES?.trim() || DEFAULT_CATEGORIES.join(','))
    .split(',')
    .map(c => c.trim())
    .filter(Boolean);

  const collected: NormalizedListing[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ page: String(page) });
    for (const category of categories) params.append('category', category);
    if (apiKey) params.set('api_key', apiKey);

    const res = await fetch(`https://www.themuse.com/api/public/jobs?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    // The Muse returns 400 for a page past the end rather than an empty result set.
    if (res.status === 400) break;
    if (!res.ok) {
      throw new Error(`The Muse request failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as MuseResponse;
    const results = body.results ?? [];
    if (results.length === 0) break;

    for (const job of results) {
      const url = job.refs?.landing_page;
      if (!job.name || !url) continue;
      // Title, categories and levels only; see relevance.ts on why the body is excluded.
      if (
        !matchesQuery(
          searchText(
            job.name,
            job.company?.name,
            job.categories?.map(c => c.name).join(' '),
            job.levels?.map(l => l.name).join(' ')
          ),
          query
        )
      ) {
        continue;
      }
      collected.push({
        externalId: job.id != null ? String(job.id) : (job.short_name ?? null),
        title: job.name,
        company: job.company?.name ?? 'Unknown company',
        location: job.locations?.map(l => l.name).filter(Boolean).join(', ') || null,
        description: [
          job.contents ? stripHtml(job.contents) : null,
          [...(job.categories ?? []), ...(job.levels ?? [])].map(v => v.name).filter(Boolean).join(', ') || null,
        ]
          .filter(Boolean)
          .join('\n\n') || null,
        url,
        salaryMin: null,
        salaryMax: null,
        postedAt: job.publication_date ?? null,
      });
    }

    if (body.page_count != null && page + 1 >= body.page_count) break;
  }

  return collected;
}
