import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';

export async function matchesRoutes(app: FastifyInstance) {
  /**
   * Ranked matches. Dismissed postings are excluded unless `?includeDismissed=true`.
   *
   * Filtering here rather than in the browser is what makes a dismissal mean something: this one
   * endpoint feeds the dashboard, the auto-scheduler, and the tailoring queue, so a dismissed
   * posting stops costing Claude sessions the moment it is dismissed — not just stops being
   * rendered.
   */
  app.get('/api/matches', async request => {
    const { includeDismissed } = request.query as { includeDismissed?: string };
    const candidate = getDefaultCandidate();
    const matches = db
      .prepare(
        `
      SELECT j.id AS jobId, j.title, j.company, j.location, j.url,
             j.salary_min AS salaryMin, j.salary_max AS salaryMax, j.posted_at AS postedAt,
             j.dismissed_at AS dismissedAt,
             m.score, m.rationale,
             a.id AS applicationId, a.status AS applicationStatus,
             a.resume_sent_at AS resumeSentAt
      FROM matches m
      JOIN jobs j ON j.id = m.job_id
      LEFT JOIN applications a ON a.job_id = j.id AND a.candidate_id = m.candidate_id
      WHERE m.candidate_id = ?
        AND (? = 1 OR j.dismissed_at IS NULL)
      ORDER BY m.score DESC, j.created_at DESC
    `
      )
      .all(candidate.id, includeDismissed === 'true' ? 1 : 0);

    return { matches };
  });
}
