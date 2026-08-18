import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';
import { nextScanTime } from '../scheduler.js';

export async function overviewRoutes(app: FastifyInstance) {
  app.get('/api/overview', async () => {
    const candidate = getDefaultCandidate();

    const newRoles = (db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number }).n;
    const strongMatches = (
      db.prepare(`SELECT COUNT(*) AS n FROM matches WHERE candidate_id = ? AND score >= 70`).get(candidate.id) as {
        n: number;
      }
    ).n;
    const applicationsPrepared = (
      db.prepare(`SELECT COUNT(*) AS n FROM applications WHERE candidate_id = ?`).get(candidate.id) as {
        n: number;
      }
    ).n;
    const activeSources = (db.prepare(`SELECT COUNT(*) AS n FROM sources WHERE enabled = 1`).get() as {
      n: number;
    }).n;

    return {
      candidateName: candidate.name,
      newRoles,
      strongMatches,
      applicationsPrepared,
      activeSources,
      nextScanAt: nextScanTime(),
    };
  });
}
