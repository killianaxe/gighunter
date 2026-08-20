import type { SourceType } from '../db/types.js';

export interface ConnectorCapabilities {
  search: boolean;
  filter: boolean;
  fullJd: 'yes' | 'partial' | 'no';
  salary: 'yes' | 'partial' | 'no';
  remote: boolean;
  contractType: boolean;
  applicationUrl: boolean;
  applicationApi: boolean;
  authRequired: boolean;
  registrationRequired: boolean;
  cost: string;
  rateLimit?: string;
  terms?: string;
}

/** What Scout can legitimately do with each source, so the pipeline never has to guess. */
export const CONNECTOR_CAPABILITIES: Record<SourceType, ConnectorCapabilities> = {
  remotive: {
    search: true,
    filter: false,
    fullJd: 'yes',
    salary: 'partial',
    remote: true,
    contractType: false,
    applicationUrl: true,
    applicationApi: false,
    authRequired: false,
    registrationRequired: false,
    cost: 'Free',
    terms: 'Public API intended for sharing listings with attribution; do not republish to other job boards.',
  },
  rss: {
    search: false,
    filter: false,
    fullJd: 'partial',
    salary: 'no',
    remote: false,
    contractType: false,
    applicationUrl: true,
    applicationApi: false,
    authRequired: false,
    registrationRequired: false,
    cost: 'Free',
  },
  adzuna: {
    search: true,
    filter: true,
    fullJd: 'partial',
    salary: 'yes',
    remote: false,
    contractType: true,
    applicationUrl: true,
    applicationApi: false,
    authRequired: true,
    registrationRequired: true,
    cost: 'Free tier',
    rateLimit: 'Subject to Adzuna free-tier call limits',
    terms: 'Requires an app_id + app_key from developer.adzuna.com; usage governed by their API terms.',
  },
  himalayas: {
    search: true,
    filter: true,
    fullJd: 'yes',
    salary: 'yes',
    remote: true,
    contractType: true,
    applicationUrl: true,
    applicationApi: false,
    authRequired: false,
    registrationRequired: false,
    cost: 'Free',
  },
  usajobs: {
    search: true,
    filter: true,
    fullJd: 'yes',
    salary: 'yes',
    remote: true,
    contractType: true,
    applicationUrl: true,
    applicationApi: false,
    authRequired: true,
    registrationRequired: true,
    cost: 'Free',
    terms: 'Requires a registered User-Agent (your email) and Authorization-Key from developer.usajobs.gov.',
  },

  remoteok: {
    // Accepts ?tag= and ignores it — all tags return the same 101-item feed. Gighunter filters
    // locally instead, so `search` describes the board, not the outcome. See relevance.ts.
    search: false,
    filter: false,
    fullJd: 'yes',
    salary: 'partial',
    remote: true,
    contractType: false,
    applicationUrl: true,
    applicationApi: false,
    authRequired: false,
    registrationRequired: false,
    cost: 'Free',
    rateLimit: 'Undocumented; the feed is a single request per poll',
    terms: 'API terms require crediting Remote OK as the source with a followed link back. Do not republish listings elsewhere.',
  },
  arbeitnow: {
    // No query parameter of any kind; the API is a paginated feed. Filtering is Gighunter's.
    search: false,
    filter: false,
    fullJd: 'yes',
    salary: 'no',
    remote: true,
    contractType: true,
    applicationUrl: true,
    applicationApi: false,
    authRequired: false,
    registrationRequired: false,
    cost: 'Free',
    terms: 'Open job-board API. Germany-weighted and largely German-language.',
  },
  jobicy: {
    // Has a `tag` filter, but it matches far too loosely to stand alone ("active directory"
    // returned an SEO manager), so Gighunter re-filters every result.
    search: false,
    filter: true,
    fullJd: 'yes',
    salary: 'partial',
    remote: true,
    contractType: true,
    applicationUrl: true,
    applicationApi: false,
    authRequired: false,
    registrationRequired: false,
    cost: 'Free',
    rateLimit: 'Max 50 listings per request',
    terms: 'Feed notice asks that Jobicy be credited with a direct link and that applications go to the original job URL.',
  },
  themuse: {
    // Filters by category, not by free text. The search term is applied locally.
    search: false,
    filter: true,
    fullJd: 'yes',
    salary: 'no',
    remote: false,
    contractType: false,
    applicationUrl: true,
    applicationApi: false,
    authRequired: false,
    registrationRequired: false,
    cost: 'Free',
    rateLimit: 'Roughly 500 requests/hour unauthenticated; set MUSE_API_KEY to raise it',
    terms: 'Public API. Category defaults to Computer and IT — override with MUSE_CATEGORIES.',
  },
  jooble: {
    // The only Phase 2 board with real server-side search.
    search: true,
    filter: true,
    fullJd: 'partial',
    salary: 'partial',
    remote: false,
    contractType: true,
    applicationUrl: true,
    applicationApi: false,
    authRequired: true,
    registrationRequired: true,
    cost: 'Free',
    terms: 'Requires a free JOOBLE_API_KEY from jooble.org/api/about. Aggregator: listings originate on other boards and the snippet is an excerpt, not the full posting.',
  },
};
