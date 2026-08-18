import type { NormalizedListing } from '../db/types.js';

const USER_AGENT = 'Orbit/0.1 (+local job search assistant)';

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
  publication_date?: string;
}

interface RemotiveResponse {
  jobs: RemotiveJob[];
}

/** Public, keyless Remotive JSON API — not scraping, no access controls bypassed. */
export async function fetchRemotive(query: string): Promise<NormalizedListing[]> {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Remotive request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as RemotiveResponse;
  return data.jobs.map(job => {
    const salary = parseSalaryRange(job.salary);
    return {
      externalId: String(job.id),
      title: job.title,
      company: job.company_name,
      // Remotive is a remote-only board; fold that into the location string so downstream
      // matching (which looks for "remote" in the text) recognizes these as remote-friendly.
      location: job.candidate_required_location ? `Remote (${job.candidate_required_location})` : 'Remote',
      description: job.description ? stripHtml(job.description) : null,
      url: job.url,
      salaryMin: salary.min,
      salaryMax: salary.max,
      postedAt: job.publication_date ?? null,
    };
  });
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseSalaryRange(raw: string | undefined): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null };
  const numbers = raw.replace(/,/g, '').match(/\d+(\.\d+)?/g);
  if (!numbers || numbers.length === 0) return { min: null, max: null };
  const values = numbers.map(Number).filter(n => n > 1000);
  if (values.length === 0) return { min: null, max: null };
  return { min: Math.min(...values), max: Math.max(...values) };
}
