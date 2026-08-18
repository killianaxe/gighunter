import type { NormalizedListing } from '../db/types.js';

interface UsajobsPositionRemuneration {
  MinimumRange?: string;
  MaximumRange?: string;
}

interface UsajobsMatchedObjectDescriptor {
  PositionID: string;
  PositionTitle: string;
  OrganizationName?: string;
  PositionLocationDisplay?: string;
  UserArea?: { Details?: { JobSummary?: string } };
  PositionURI: string;
  PositionRemuneration?: UsajobsPositionRemuneration[];
  PublicationStartDate?: string;
}

interface UsajobsSearchResultItem {
  MatchedObjectDescriptor: UsajobsMatchedObjectDescriptor;
}

interface UsajobsResponse {
  SearchResult?: { SearchResultItems?: UsajobsSearchResultItem[] };
}

/**
 * Requires USAJOBS_API_KEY + USAJOBS_USER_AGENT (register at developer.usajobs.gov).
 * Built from documented USAJOBS Search API conventions — not live-verified during
 * development (developer.usajobs.gov refused every fetch attempt); smoke-test once a
 * key is available.
 */
export async function fetchUsajobs(query: string): Promise<NormalizedListing[]> {
  const apiKey = process.env.USAJOBS_API_KEY;
  const userAgent = process.env.USAJOBS_USER_AGENT;

  if (!apiKey || !userAgent) {
    throw new Error(
      'USAJOBS requires USAJOBS_API_KEY and USAJOBS_USER_AGENT in server/.env (register at developer.usajobs.gov)'
    );
  }

  const url = `https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(query)}&ResultsPerPage=25`;
  const res = await fetch(url, {
    headers: {
      Host: 'data.usajobs.gov',
      'User-Agent': userAgent,
      'Authorization-Key': apiKey,
    },
  });
  if (!res.ok) {
    throw new Error(`USAJOBS request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as UsajobsResponse;
  const items = data.SearchResult?.SearchResultItems ?? [];

  return items.map(item => {
    const job = item.MatchedObjectDescriptor;
    const pay = job.PositionRemuneration?.[0];
    return {
      externalId: job.PositionID,
      title: job.PositionTitle,
      company: job.OrganizationName ?? 'U.S. Government',
      location: job.PositionLocationDisplay ?? null,
      description: job.UserArea?.Details?.JobSummary ?? null,
      url: job.PositionURI,
      salaryMin: pay?.MinimumRange ? Number(pay.MinimumRange) : null,
      salaryMax: pay?.MaximumRange ? Number(pay.MaximumRange) : null,
      postedAt: job.PublicationStartDate ?? null,
    };
  });
}
