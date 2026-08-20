import type { NormalizedListing } from '../db/types.js';
import { matchesQuery, nullableSalary, searchText, stripHtml } from './relevance.js';

const USER_AGENT = 'Gighunter/0.1 (+local job search assistant)';

/** Jobicy caps `count` at 50. */
const COUNT = 50;

interface JobicyJob {
  id?: number;
  url?: string;
  jobSlug?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  annualSalaryMin?: number;
  annualSalaryMax?: number;
  salaryCurrency?: string;
}

interface JobicyResponse {
  jobs?: JobicyJob[];
}

/**
 * Public, keyless Jobicy remote-jobs feed.
 *
 * The `tag` parameter is passed through as a first-pass narrowing, but its matching is far too
 * loose to trust on its own — `tag=vmware` returned a Technical Product Marketer, and
 * `tag=active directory` returned an International SEO Manager. So the result is filtered again
 * locally. Sending the tag anyway is still worth it: it lets the board do the coarse work and
 * keeps the payload small.
 *
 * Salary fields are documented but absent from most listings, hence 'partial' in capabilities.
 *
 * Attribution: Jobicy's feed notice asks that Jobicy be credited with a direct link and that
 * application buttons point at the original job URL. Gighunter stores exactly that URL and never
 * republishes the listing.
 */
export async function fetchJobicy(query: string): Promise<NormalizedListing[]> {
  const url =
    `https://jobicy.com/api/v2/remote-jobs?count=${COUNT}&tag=${encodeURIComponent(query)}`;

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Jobicy request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as JobicyResponse;

  return (data.jobs ?? [])
    .filter(job => job.jobTitle && job.url)
    // Jobicy's own tag filter already ran server-side; this is the second, strict pass that
    // rejects what it let through. Industry/level/type are the board's own labels, so they
    // belong in the haystack alongside the title.
    .filter(job =>
      matchesQuery(
        searchText(job.jobTitle, job.companyName, job.jobIndustry?.join(' '), job.jobLevel, job.jobType?.join(' ')),
        query
      )
    )
    .map(job => ({
      externalId: job.id != null ? String(job.id) : (job.jobSlug ?? null),
      title: job.jobTitle!,
      // Jobicy HTML-escapes fields like jobIndustry ("DevOps &amp; Infrastructure"), so every
      // text field goes through the same unescaping the description gets.
      company: job.companyName ? stripHtml(job.companyName) : 'Unknown company',
      location: job.jobGeo ? stripHtml(job.jobGeo) : 'Remote',
      description: [
        job.jobDescription ? stripHtml(job.jobDescription) : (job.jobExcerpt ? stripHtml(job.jobExcerpt) : null),
        [...(job.jobIndustry ?? []), ...(job.jobType ?? []), job.jobLevel]
          .filter(Boolean)
          .map(v => stripHtml(String(v)))
          .join(', ') || null,
      ]
        .filter(Boolean)
        .join('\n\n') || null,
      url: job.url!,
      // Guarded like the other boards: Jobicy documents these fields but omits them from most
      // listings, and a board that reports "unknown" as 0 would otherwise be stored as a real
      // $0 range — which reads as "pays nothing" to the matcher's salary overlap and renders a
      // "$0k" tag in the UI.
      salaryMin: nullableSalary(job.annualSalaryMin),
      salaryMax: nullableSalary(job.annualSalaryMax),
      postedAt: job.pubDate ?? null,
    }));
}
