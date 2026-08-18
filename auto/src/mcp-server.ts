import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { config } from './config.js';
import { ensureOrbitRunning } from './ensure-orbit.js';
import { orbit } from './orbit-client.js';

const server = new McpServer({ name: 'autogighunter', version: '0.1.0' });

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function withOrbit<T>(fn: () => Promise<T>) {
  await ensureOrbitRunning();
  return fn();
}

server.registerTool(
  'orbit_overview',
  { description: "Dashboard summary: new roles found, strong matches, applications prepared, active sources, next scan time." , inputSchema: z.object({}) },
  async () => text(await withOrbit(orbit.getOverview))
);

server.registerTool(
  'orbit_matches',
  {
    description: 'Ranked job matches with scores and rationale. Optionally filter to a minimum score.',
    inputSchema: z.object({ minScore: z.number().min(0).max(100).optional() }),
  },
  async ({ minScore }) => text(await withOrbit(() => orbit.getMatches(minScore)))
);

server.registerTool(
  'orbit_scan',
  { description: 'Triggers a live scan of all enabled sources and scores any new listings.', inputSchema: z.object({}) },
  async () => text(await withOrbit(orbit.runScan))
);

server.registerTool(
  'orbit_rescore',
  {
    description: 'Re-scores every already-ingested job against the current profile, without re-polling sources.',
    inputSchema: z.object({}),
  },
  async () => text(await withOrbit(orbit.rescore))
);

server.registerTool(
  'orbit_list_sources',
  { description: 'Lists all configured job sources (Remotive, Himalayas, Adzuna, USAJOBS, RSS feeds).', inputSchema: z.object({}) },
  async () => text(await withOrbit(orbit.listSources))
);

server.registerTool(
  'orbit_add_source',
  {
    description:
      'Adds a new job source. type must be one of remotive, himalayas, adzuna, usajobs, rss. input is a search keyword for API sources, or a feed URL for type "rss".',
    inputSchema: z.object({
      type: z.enum(['remotive', 'himalayas', 'adzuna', 'usajobs', 'rss']),
      input: z.string().min(1),
      name: z.string().optional(),
    }),
  },
  async ({ type, input, name }) => text(await withOrbit(() => orbit.addSource(type, input, name)))
);

server.registerTool(
  'orbit_draft_application',
  {
    description:
      'Tailors a draft application (headline, summary, resume bullets) for a job, built strictly from the candidate\'s real profile — no fabrication.',
    inputSchema: z.object({ jobId: z.string().min(1) }),
  },
  async ({ jobId }) => text(await withOrbit(() => orbit.draftApplication(jobId)))
);

server.registerTool(
  'orbit_get_application',
  { description: 'Fetches a previously drafted or approved application by id.', inputSchema: z.object({ applicationId: z.string().min(1) }) },
  async ({ applicationId }) => text(await withOrbit(() => orbit.getApplication(applicationId)))
);

server.registerTool(
  'orbit_download_resume',
  {
    description:
      'Generates and saves the full tailored .docx resume (contact info, work history, tailored bullets, certifications, education) for a drafted application. Returns the saved file path — it does not submit anything anywhere.',
    inputSchema: z.object({ applicationId: z.string().min(1) }),
  },
  async ({ applicationId }) => text(await withOrbit(() => orbit.downloadResume(applicationId)))
);

server.registerTool(
  'orbit_approve_application',
  {
    description:
      'Marks an application approved and returns the real posting URL. This NEVER submits anything automatically — approving only unlocks the link for a human to open and complete the application themselves.',
    inputSchema: z.object({ applicationId: z.string().min(1) }),
  },
  async ({ applicationId }) => text(await withOrbit(() => orbit.approveApplication(applicationId)))
);

server.registerTool(
  'orbit_pending_review',
  {
    description:
      `Strong matches (score >= threshold, default ${config.autoDraftThreshold}) that already have a drafted-but-not-yet-approved application — i.e. what's ready for a human to look at right now.`,
    inputSchema: z.object({ minScore: z.number().min(0).max(100).optional() }),
  },
  async ({ minScore }) =>
    text(
      await withOrbit(async () => {
        const matches = await orbit.getMatches(minScore ?? config.autoDraftThreshold);
        return matches.filter(m => m.applicationStatus === 'drafted');
      })
    )
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('autogighunter MCP server failed to start:', err);
  process.exit(1);
});
