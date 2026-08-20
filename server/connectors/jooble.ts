import type { NormalizedListing } from '../db/types.js';
import { stripHtml } from './relevance.js';

interface JoobleJob {
  id?: number;
  title?: string;
  company?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  type?: string;
  link?: string;
  updated?: string;
  source?: string;
}

interface JoobleResponse {
  totalCount?: number;
  jobs?: JoobleJob[];
}

/**
 * Jooble aggregator search. Requires JOOBLE_API_KEY (free key from jooble.org/api/about).
 *
 * The only Phase 2 board that does real server-side search, so unlike its siblings there is no
 * local relevance filtering here — the query goes to Jooble and Jooble decides. The key is part
 * of the URL path rather than a header, which is Jooble's design, not a mistake.
 *
 * Jooble returns `snippet`, a short excerpt, rather than the full posting — hence 'partial'
 * full-JD in capabilities. The matcher therefore sees less text per listing than it does for
 * Remotive or Himalayas, which biases Jooble listings toward title-driven scoring.
 */
export async function fetchJooble(query: string): Promise<NormalizedListing[]> {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) {
    throw new Error('Jooble requires JOOBLE_API_KEY in server/.env (free key from jooble.org/api/about)');
  }

  const res = await fetch(`https://jooble.org/api/${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords: query,
      location: process.env.JOOBLE_LOCATION || '',
      ResultOnPage: 50,
    }),
  });

  if (!res.ok) {
    throw new Error(`Jooble request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as JoobleResponse;

  return (data.jobs ?? [])
    .filter(job => job.title && job.link)
    .map(job => {
      const [salaryMin, salaryMax] = parseSalary(job.salary);
      return {
        externalId: job.id != null ? String(job.id) : null,
        title: job.title!,
        company: job.company?.trim() || 'Unknown company',
        location: job.location?.trim() || null,
        description: [job.snippet ? stripHtml(job.snippet) : null, job.type]
          .filter(Boolean)
          .join('\n\n') || null,
        url: job.link!,
        salaryMin,
        salaryMax,
        postedAt: job.updated ?? null,
      };
    });
}

/**
 * Jooble reports salary as free text rather than numbers — "$95,000 - $120,000 per year",
 * "£450 per day", "" — because it aggregates whatever each origin board published.
 *
 * Only annual figures are parsed. A day rate and an annual salary are not comparable, and
 * feeding "450" to a matcher calibrated against a $140k–$190k range would score every contract
 * role as far below minimum. Anything not clearly annual is left null, which the matcher
 * already treats as "unknown", not "zero".
 */
export function parseSalary(raw: string | undefined): [number | null, number | null] {
  if (!raw) return [null, null];

  const text = raw.toLowerCase();
  if (/per\s+(hour|day|week|month)|hourly|daily|weekly|monthly|\/\s*(hr|hour|day)/.test(text)) {
    return [null, null];
  }

  const numbers = [...text.matchAll(/(\d[\d,.]*)\s*(k\b)?/g)]
    .map(match => {
      const value = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(value)) return null;
      return match[2] ? value * 1000 : value;
    })
    .filter((value): value is number => value != null && value >= 1000);

  if (numbers.length === 0) return [null, null];
  if (numbers.length === 1) return [numbers[0], null];
  return [Math.min(...numbers), Math.max(...numbers)];
}
