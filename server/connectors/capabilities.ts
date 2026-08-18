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
};
