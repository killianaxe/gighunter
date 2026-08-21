import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';
import { pollSources } from '../pipeline/poll.js';
import { matchUnscoredJobs, rescoreAll } from '../pipeline/match.js';
import { pruneOldJobs } from '../db/retention.js';
import { logAudit } from '../db/audit.js';
import type { SourceRow } from '../db/types.js';

export async function scanRoutes(app: FastifyInstance) {
  app.post('/api/scan', async () => {
    const candidate = getDefaultCandidate();
    const sources = db.prepare(`SELECT * FROM sources WHERE enabled = 1`).all() as SourceRow[];

    const pollSummary = await pollSources(sources);
    const newMatches = matchUnscoredJobs(candidate);

    // Prune after scoring, not before: a job pruned first would just be re-ingested by the poll
    // that ran moments ago. Running last means the cutoff applies to what actually survived.
    const pruned = pruneOldJobs();

    logAudit('scan', candidate.id, 'run', `${pollSummary.newJobs} new jobs, ${newMatches} newly scored`);

    return { ...pollSummary, newMatches, pruned };
  });

  // Re-scores already-ingested jobs against the current profile — no re-polling. Use after
  // editing server/profile.json (skills, salary, locations, exclusions) and re-running npm run seed.
  app.post('/api/rescore', async () => {
    const candidate = getDefaultCandidate();
    const rescored = rescoreAll(candidate);
    logAudit('scan', candidate.id, 'rescore', `${rescored} jobs re-scored`);
    return { rescored };
  });
}
