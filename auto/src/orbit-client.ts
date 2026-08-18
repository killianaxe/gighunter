import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';

export interface OverviewResponse {
  candidateName: string;
  newRoles: number;
  strongMatches: number;
  applicationsPrepared: number;
  activeSources: number;
  nextScanAt: string | null;
}

export interface MatchEntry {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  salaryMin: number | null;
  salaryMax: number | null;
  postedAt: string | null;
  score: number;
  rationale: string;
  applicationId: string | null;
  applicationStatus: 'drafted' | 'approved' | null;
}

export interface ScanSummary {
  sourcesPolled: number;
  listingsSeen: number;
  newJobs: number;
  errors: { sourceId: string; sourceName: string; message: string }[];
  newMatches: number;
}

export interface SourceEntry {
  id: string;
  name: string;
  type: string;
  query_or_url: string;
  cadence_minutes: number;
  enabled: number;
  last_polled_at: string | null;
  created_at: string;
}

export interface ApplicationDetail {
  id: string;
  status: 'drafted' | 'approved';
  headline: string | null;
  summary: string | null;
  bullets: string[];
  job: { id: string; title: string; company: string; url: string; location: string | null };
  createdAt: string;
  decidedAt: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.orbitBaseUrl}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Orbit request ${path} failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return (await res.json()) as T;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const orbit = {
  getOverview: () => request<OverviewResponse>('/api/overview'),

  getMatches: async (minScore?: number): Promise<MatchEntry[]> => {
    const { matches } = await request<{ matches: MatchEntry[] }>('/api/matches');
    return minScore == null ? matches : matches.filter(m => m.score >= minScore);
  },

  runScan: () => postJson<ScanSummary>('/api/scan'),

  rescore: () => postJson<{ rescored: number }>('/api/rescore'),

  listSources: async (): Promise<SourceEntry[]> => {
    const { sources } = await request<{ sources: SourceEntry[] }>('/api/sources');
    return sources;
  },

  addSource: (type: string, input: string, name?: string) =>
    postJson<{ source: SourceEntry }>('/api/sources', { type, input, name }),

  setSourceEnabled: (id: string, enabled: boolean) =>
    request<{ source: SourceEntry }>(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),

  getCapabilities: () => request<{ capabilities: Record<string, unknown> }>('/api/sources/capabilities'),

  draftApplication: (jobId: string) => postJson<ApplicationDetail>(`/api/applications/${jobId}/draft`),

  getApplication: (id: string) => request<ApplicationDetail>(`/api/applications/${id}`),

  approveApplication: (id: string) => postJson<ApplicationDetail>(`/api/applications/${id}/approve`),

  getAuditLog: () => request<{ entries: unknown[] }>('/api/audit'),

  /** Downloads the tailored .docx and saves it locally, using Orbit's own filename. Returns the saved path. */
  downloadResume: async (applicationId: string): Promise<string> => {
    const res = await fetch(`${config.orbitBaseUrl}/api/applications/${applicationId}/resume.docx`);
    if (!res.ok) {
      throw new Error(`Resume download failed: ${res.status} ${res.statusText}`);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `${applicationId}.docx`;

    mkdirSync(config.resumeDownloadDir, { recursive: true });
    const destPath = resolve(config.resumeDownloadDir, filename);
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(destPath, buffer);
    return destPath;
  },
};
