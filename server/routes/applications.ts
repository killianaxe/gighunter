import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';
import { draftApplication } from '../pipeline/draft.js';
import { buildResumeDocx, resumeFilename } from '../pipeline/resume.js';
import { logAudit } from '../db/audit.js';
import type { ApplicationRow, JobRow } from '../db/types.js';

function serializeApplication(application: ApplicationRow, job: JobRow) {
  return {
    id: application.id,
    status: application.status,
    headline: application.draft_headline,
    summary: application.draft_summary,
    bullets: JSON.parse(application.draft_bullets_json) as string[],
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.url,
      location: job.location,
    },
    createdAt: application.created_at,
    decidedAt: application.decided_at,
  };
}

export async function applicationsRoutes(app: FastifyInstance) {
  // Application (draft) agent: tailors a draft strictly from the candidate's own resume facts.
  app.post('/api/applications/:jobId/draft', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const candidate = getDefaultCandidate();
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
    if (!job) return reply.code(404).send({ error: 'job not found' });

    const application = draftApplication(job, candidate);
    return serializeApplication(application, job);
  });

  app.get('/api/applications/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const application = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(id) as ApplicationRow | undefined;
    if (!application) return reply.code(404).send({ error: 'application not found' });
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(application.job_id) as JobRow;
    return serializeApplication(application, job);
  });

  // Downloadable .docx of the tailored highlights (name, headline, summary, matched bullets, skills) —
  // not a full resume, just what the draft agent selected for this specific posting.
  app.get('/api/applications/:id/resume.docx', async (request, reply) => {
    const { id } = request.params as { id: string };
    const application = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(id) as ApplicationRow | undefined;
    if (!application) return reply.code(404).send({ error: 'application not found' });
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(application.job_id) as JobRow;
    const candidate = getDefaultCandidate();

    const buffer = await buildResumeDocx(application, job, candidate);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${resumeFilename(candidate, job)}"`)
      .send(buffer);
  });

  // Review / submit gateway: approving only unlocks the real posting URL. Nothing is ever auto-submitted.
  app.post('/api/applications/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const application = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(id) as ApplicationRow | undefined;
    if (!application) return reply.code(404).send({ error: 'application not found' });

    db.prepare(`UPDATE applications SET status = 'approved', decided_at = datetime('now') WHERE id = ?`).run(id);
    logAudit('application', id, 'approved');

    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(application.job_id) as JobRow;
    const updated = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(id) as ApplicationRow;
    return serializeApplication(updated, job);
  });
}
