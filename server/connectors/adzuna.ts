import type { NormalizedListing } from '../db/types.js';

interface AdzunaResult {
  id: string;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description?: string;
  redirect_url: string;
  salary_min?: number;
  salary_max?: number;
  created?: string;
}

interface AdzunaResponse {
  results: AdzunaResult[];
}

/**
 * Requires ADZUNA_APP_ID + ADZUNA_APP_KEY (register at developer.adzuna.com).
 * Adzuna's `description` is a "snipped" excerpt, not the full JD.
 */
export async function fetchAdzuna(query: string): Promise<NormalizedListing[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const country = process.env.ADZUNA_COUNTRY || 'us';

  if (!appId || !appKey) {
    throw new Error(
      'Adzuna requires ADZUNA_APP_ID and ADZUNA_APP_KEY in server/.env (register at developer.adzuna.com)'
    );
  }

  const url =
    `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1` +
    `?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}` +
    `&what=${encodeURIComponent(query)}&results_per_page=20&content-type=application/json`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Adzuna request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as AdzunaResponse;

  return (data.results ?? []).map(job => ({
    externalId: job.id,
    title: job.title,
    company: job.company?.display_name ?? 'Unknown company',
    location: job.location?.display_name ?? null,
    description: job.description ?? null,
    url: job.redirect_url,
    salaryMin: job.salary_min ?? null,
    salaryMax: job.salary_max ?? null,
    postedAt: job.created ?? null,
  }));
}
