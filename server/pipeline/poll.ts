import { db } from '../db/index.js';
import { newId } from '../util/id.js';
import { fetchRemotive } from '../connectors/remotive.js';
import { fetchRss } from '../connectors/rss.js';
import { fetchAdzuna } from '../connectors/adzuna.js';
import { fetchHimalayas } from '../connectors/himalayas.js';
import { fetchUsajobs } from '../connectors/usajobs.js';
import { fetchRemoteOk } from '../connectors/remoteok.js';
import { fetchArbeitnow } from '../connectors/arbeitnow.js';
import { fetchJobicy } from '../connectors/jobicy.js';
import { fetchTheMuse } from '../connectors/themuse.js';
import { fetchJooble } from '../connectors/jooble.js';
import { normalizedKey } from './normalize.js';
import { logAudit } from '../db/audit.js';
import type { SourceRow, NormalizedListing, SourceType } from '../db/types.js';

const CONNECTORS: Record<SourceType, (query: string) => Promise<NormalizedListing[]>> = {
  remotive: fetchRemotive,
  rss: fetchRss,
  adzuna: fetchAdzuna,
  himalayas: fetchHimalayas,
  usajobs: fetchUsajobs,
  remoteok: fetchRemoteOk,
  arbeitnow: fetchArbeitnow,
  jobicy: fetchJobicy,
  themuse: fetchTheMuse,
  jooble: fetchJooble,
};

export interface PollSummary {
  sourcesPolled: number;
  listingsSeen: number;
  newJobs: number;
  errors: { sourceId: string; sourceName: string; message: string }[];
}

const insertJob = db.prepare(`
  INSERT OR IGNORE INTO jobs
    (id, source_id, external_id, title, company, location, description, url, salary_min, salary_max, posted_at, normalized_key)
  VALUES (@id, @sourceId, @externalId, @title, @company, @location, @description, @url, @salaryMin, @salaryMax, @postedAt, @normalizedKey)
`);

const touchSource = db.prepare(`UPDATE sources SET last_polled_at = datetime('now') WHERE id = ?`);

/** Fetches each source via its connector, normalizes listings, and dedupes into jobs by normalized_key. */
export async function pollSources(sources: SourceRow[]): Promise<PollSummary> {
  const summary: PollSummary = { sourcesPolled: 0, listingsSeen: 0, newJobs: 0, errors: [] };

  for (const source of sources) {
    summary.sourcesPolled += 1;
    try {
      const listings = await CONNECTORS[source.type](source.query_or_url);

      summary.listingsSeen += listings.length;
      let inserted = 0;
      for (const listing of listings) {
        const result = insertJob.run(toRow(source.id, listing));
        if (result.changes > 0) inserted += 1;
      }
      summary.newJobs += inserted;
      touchSource.run(source.id);
      logAudit('source', source.id, 'poll', `${listings.length} listings, ${inserted} new`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ sourceId: source.id, sourceName: source.name, message });
      logAudit('source', source.id, 'poll_error', message);
    }
  }

  return summary;
}

function toRow(sourceId: string, listing: NormalizedListing) {
  return {
    id: newId(),
    sourceId,
    externalId: listing.externalId,
    title: listing.title,
    company: listing.company,
    location: listing.location,
    description: listing.description,
    url: listing.url,
    salaryMin: listing.salaryMin,
    salaryMax: listing.salaryMax,
    postedAt: listing.postedAt,
    normalizedKey: normalizedKey(listing.title, listing.company),
  };
}
