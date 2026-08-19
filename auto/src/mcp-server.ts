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
  'orbit_send_resume_to_telegram',
  {
    description:
      "Sends the tailored .docx resume for an application into the Telegram chat, where it can be saved on a phone and attached to the real application from there. Use this when the candidate is away from the machine Orbit runs on — the normal download link points at localhost and does not work on mobile. Requires the Telegram notifier to be configured and enabled.",
    inputSchema: z.object({ applicationId: z.string().min(1) }),
  },
  async ({ applicationId }) => text(await withOrbit(() => orbit.sendResumeToTelegram(applicationId)))
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


/**
 * The tailoring pair. These are what let a Claude Code session do the tailoring itself instead of
 * Orbit paying for an API call: the agent reads the context, reasons, and writes the result back.
 * Orbit stays mechanical — it serves material and stores an answer, and never calls a model.
 */
server.registerTool(
  'orbit_tailoring_context',
  {
    description:
      "Everything needed to tailor a resume for one job: the posting, the candidate's full accomplishment library, and Orbit's honesty rules (never invent experience; preserve every metric, date, and proper noun exactly). Read this, write the tailoring yourself, then save it with orbit_save_tailoring.",
    inputSchema: z.object({ jobId: z.string().min(1) }),
  },
  async ({ jobId }) => text(await withOrbit(() => orbit.getTailoringContext(jobId)))
);

server.registerTool(
  'orbit_save_tailoring',
  {
    description:
      'Saves a tailoring you wrote for a job, replacing the placeholder draft. Orbit validates the shape and returns 400 with specific issues if anything is missing — fix and resend. Every bullet\'s tailoredText must be a rewrite of real candidate material, never new experience.',
    inputSchema: z.object({
      jobId: z.string().min(1),
      headline: z.string().min(1).describe('One line positioning the candidate for this specific role. No template phrasing.'),
      summary: z.string().min(1).describe('Two or three sentences of professional summary aimed at this posting.'),
      bullets: z
        .array(
          z.object({
            sourceText: z.string().describe('The original bullet, copied exactly, so the rewrite can be diffed.'),
            tailoredText: z.string().describe('The rewrite, leading with the vocabulary this posting uses.'),
            changed: z.boolean().describe('False when the original already fit and was returned unmodified.'),
          })
        )
        .min(1)
        .describe('The 4-6 most relevant bullets, strongest first.'),
      leadSkills: z.array(z.string()).describe('Candidate skills ordered by relevance to this posting.'),
      leadCertifications: z.array(z.string()).describe('Candidate certifications ordered by relevance.'),
      keywordGaps: z.array(z.string()).describe('Terms this posting emphasises that the candidate genuinely lacks. An honest gap list — do not fill it in.'),
      coveredButUnstated: z
        .array(z.string())
        .describe('Terms the posting wants that the candidate demonstrably has but never names literally (e.g. holds VCP-Network Virtualization but never writes "NSX"). These are silent ATS failures.'),
      fitAssessment: z.string().describe('One honest sentence on fit, including reasons not to apply if they exist.'),
    }),
  },
  async ({ jobId, ...tailoring }) => text(await withOrbit(() => orbit.saveTailoring(jobId, tailoring)))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('autogighunter MCP server failed to start:', err);
  process.exit(1);
});
