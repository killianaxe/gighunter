import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';

export async function matchesRoutes(app: FastifyInstance) {
  app.get('/api/matches', async () => {
    const candidate = getDefaultCandidate();
    const matches = db
      .prepare(
        `
      SELECT j.id AS jobId, j.title, j.company, j.location, j.url,
             j.salary_min AS salaryMin, j.salary_max AS salaryMax, j.posted_at AS postedAt,
             m.score, m.rationale,
             a.id AS applicationId, a.status AS applicationStatus
      FROM matches m
      JOIN jobs j ON j.id = m.job_id
      LEFT JOIN applications a ON a.job_id = j.id AND a.candidate_id = m.candidate_id
      WHERE m.candidate_id = ?
      ORDER BY m.score DESC, j.created_at DESC
    `
      )
      .all(candidate.id);

    return { matches };
  });
}
