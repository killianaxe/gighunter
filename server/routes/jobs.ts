import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { logAudit } from '../db/audit.js';
import type { JobRow } from '../db/types.js';

/**
 * Dismissing a posting.
 *
 * The flag lives on jobs, not matches, because rescoreAll() deletes and rebuilds every match row
 * — a dismissal stored there would survive exactly until the next rescore and then silently
 * un-dismiss itself. Storing it on the job also means a re-poll of the same listing stays
 * dismissed: normalized_key is UNIQUE, so the posting maps back to the same row rather than
 * arriving as a new one.
 *
 * Dismissal is reversible on purpose. It is a triage action taken quickly over a long list, which
 * is exactly the kind of action people get wrong, so nothing is destroyed — the row keeps its
 * score, its rationale, and any application already built from it.
 */
export async function jobsRoutes(app: FastifyInstance) {
  app.post('/api/jobs/:id/dismiss', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
    if (!job) return reply.code(404).send({ error: 'job not found' });

    db.prepare(`UPDATE jobs SET dismissed_at = datetime('now') WHERE id = ?`).run(id);
    logAudit('job', id, 'dismissed', `${job.title} — ${job.company}`);

    const updated = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow;
    return { id: updated.id, title: updated.title, company: updated.company, dismissedAt: updated.dismissed_at };
  });

  app.post('/api/jobs/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
    if (!job) return reply.code(404).send({ error: 'job not found' });

    db.prepare(`UPDATE jobs SET dismissed_at = NULL WHERE id = ?`).run(id);
    logAudit('job', id, 'restored', `${job.title} — ${job.company}`);

    return { id: job.id, title: job.title, company: job.company, dismissedAt: null };
  });

  /** Everything currently dismissed, newest first — the undo list. */
  app.get('/api/jobs/dismissed', async () => {
    const jobs = db
      .prepare(
        `SELECT id, title, company, location, url, dismissed_at AS dismissedAt
         FROM jobs WHERE dismissed_at IS NOT NULL ORDER BY dismissed_at DESC`
      )
      .all();
    return { jobs };
  });
}
