import type { NormalizedListing } from '../db/types.js';
import { matchesQuery, searchText, stripHtml } from './relevance.js';

const USER_AGENT = 'Gighunter/0.1 (+local job search assistant)';

/** Pages are 100 listings each; five keeps a poll to ~6 MB and a few seconds. */
const MAX_PAGES = 5;

interface ArbeitnowJob {
  slug?: string;
  title?: string;
  company_name?: string;
  description?: string;
  location?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  created_at?: number;
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
  links?: { next?: string | null };
}

/**
 * Public, keyless Arbeitnow job board API.
 *
 * The API takes no query parameter, so this walks pages and filters locally (see relevance.ts).
 * The board is Germany-weighted and largely German-language, which the relevance filter handles
 * incidentally: an English query simply will not match a German posting. That is the intended
 * outcome, not a gap — it surfaces the English-language and remote roles worth seeing.
 *
 * Arbeitnow exposes no salary fields at all, so every listing lands with a null range and is
 * scored on skills and location alone.
 */
export async function fetchArbeitnow(query: string): Promise<NormalizedListing[]> {
  const collected: NormalizedListing[] = [];
  let url: string | null = 'https://www.arbeitnow.com/api/job-board-api';

  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    const res: Response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`Arbeitnow request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as ArbeitnowResponse;

    for (const job of body.data ?? []) {
      if (!job.title || !job.url) continue;
      // Title and tags only; see relevance.ts on why the description body is excluded.
      if (!matchesQuery(searchText(job.title, job.company_name, job.tags?.join(' ')), query)) continue;
      collected.push({
        externalId: job.slug ?? null,
        title: job.title,
        company: job.company_name ?? 'Unknown company',
        location: job.remote ? `Remote (${job.location ?? 'Germany'})` : (job.location ?? null),
        description: [
          job.description ? stripHtml(job.description) : null,
          [...(job.tags ?? []), ...(job.job_types ?? [])].join(', ') || null,
        ]
          .filter(Boolean)
          .join('\n\n') || null,
        url: job.url,
        salaryMin: null,
        salaryMax: null,
        // created_at is a Unix timestamp in seconds, unlike every other connector's ISO string.
        postedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : null,
      });
    }

    url = body.links?.next ?? null;
  }

  return collected;
}
