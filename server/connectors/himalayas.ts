import type { NormalizedListing } from '../db/types.js';

const USER_AGENT = 'Gighunter/0.1 (+local job search assistant)';

interface HimalayasJob {
  guid: string;
  title: string;
  companyName?: string;
  description?: string;
  locationRestrictions?: string[];
  minSalary?: number;
  maxSalary?: number;
  applicationLink?: string;
  pubDate?: string;
}

interface HimalayasResponse {
  jobs?: HimalayasJob[];
}

/** Public, keyless Himalayas JSON API — no registration required. */
export async function fetchHimalayas(query: string): Promise<NormalizedListing[]> {
  const url = `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Himalayas request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as HimalayasResponse | HimalayasJob[];
  const jobs = Array.isArray(data) ? data : (data.jobs ?? []);

  return jobs
    .map(job => ({
      externalId: job.guid,
      title: job.title,
      company: job.companyName ?? 'Unknown company',
      location:
        job.locationRestrictions && job.locationRestrictions.length > 0
          ? `Remote (${job.locationRestrictions.join(', ')})`
          : 'Remote (Worldwide)',
      description: job.description ? stripHtml(job.description) : null,
      url: job.applicationLink ?? '',
      salaryMin: job.minSalary ?? null,
      salaryMax: job.maxSalary ?? null,
      postedAt: job.pubDate ?? null,
    }))
    .filter(listing => Boolean(listing.url));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
