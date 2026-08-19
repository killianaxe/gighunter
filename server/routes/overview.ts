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

  /**
   * Applications prepared per day for the last seven days, oldest first.
   *
   * The dashboard chart previously rendered seven hardcoded bars and a literal "+18%". Fake
   * numbers on a progress chart are worse than no chart: the whole point of the panel is to tell
   * the candidate whether the search is actually moving.
   *
   * Counted from applications.created_at rather than the audit log, because a row in
   * applications is the durable artefact — audit entries are informational and a pruned log
   * would silently zero the history.
   */
  app.get('/api/activity', async () => {
    const candidate = getDefaultCandidate();

    const rows = db
      .prepare(
        `SELECT date(created_at) AS day, COUNT(*) AS n
         FROM applications
         WHERE candidate_id = ? AND created_at >= date('now', '-6 days')
         GROUP BY day`
      )
      .all(candidate.id) as { day: string; n: number }[];

    const counts = new Map(rows.map(r => [r.day, r.n]));
    const days: { date: string; label: string; count: number }[] = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      const date = d.toISOString().slice(0, 10);
      days.push({
        date,
        label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()],
        count: counts.get(date) ?? 0,
      });
    }

    const thisWeek = days.reduce((sum, d) => sum + d.count, 0);
    const priorWeek = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM applications
           WHERE candidate_id = ? AND created_at >= date('now','-13 days') AND created_at < date('now','-6 days')`
        )
        .get(candidate.id) as { n: number }
    ).n;

    // No prior activity means there is no percentage to report — sending 0 would render as a
    // flat week, which is a different and false claim.
    const changePct = priorWeek > 0 ? Math.round(((thisWeek - priorWeek) / priorWeek) * 100) : null;

    return { days, thisWeek, priorWeek, changePct };
  });
}
