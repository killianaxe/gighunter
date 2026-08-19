import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';
import { draftApplication } from '../pipeline/draft.js';
import { buildResumeDocx, resumeFilename } from '../pipeline/resume.js';
import { logAudit } from '../db/audit.js';
import { newId } from '../util/id.js';
import { TAILORING_RULES, TailoredApplicationSchema, candidateBrief } from '../llm/tailor.js';
import { sendResumeDocument } from '../notify/telegram.js';
import type { ApplicationRow, JobRow } from '../db/types.js';

function serializeApplication(application: ApplicationRow, job: JobRow) {
  return {
    id: application.id,
    status: application.status,
    headline: application.draft_headline,
    summary: application.draft_summary,
    bullets: JSON.parse(application.draft_bullets_json) as string[],
    tailoring: application.tailoring_json ? JSON.parse(application.tailoring_json) : null,
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

  /**
   * Everything an agent needs to tailor this posting, in one call.
   *
   * The route hands over the same candidate brief and the same honesty rules that the
   * server-side SDK path would have used (llm/tailor.ts), so a Claude Code session driving this
   * over MCP operates under identical constraints — no fabrication, metrics preserved verbatim.
   * That keeps the two paths from drifting: there is one prompt, not a copy in each.
   */
  app.get('/api/applications/:jobId/tailoring-context', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
    if (!job) return reply.code(404).send({ error: 'job not found' });
    const candidate = getDefaultCandidate();

    return {
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
      },
      candidateBrief: candidateBrief(candidate),
      rules: TAILORING_RULES,
      expectedShape: {
        headline: 'string — one line positioning the candidate for this role',
        summary: 'string — two or three sentences aimed at this posting',
        bullets: '[{ sourceText, tailoredText, changed }] — the 4-6 most relevant, strongest first',
        leadSkills: 'string[] — candidate skills ordered by relevance to this posting',
        leadCertifications: 'string[] — certifications ordered by relevance',
        keywordGaps: 'string[] — terms this posting wants that the candidate genuinely lacks',
        coveredButUnstated: 'string[] — terms the candidate evidences but never names literally',
        fitAssessment: 'string — one honest sentence, including reasons not to apply',
      },
    };
  });

  /**
   * Stores a tailoring produced elsewhere (an MCP agent on a Claude Code session, rather than a
   * billed SDK call from this server).
   *
   * Validated against the same Zod schema the SDK path uses. An agent is not a structured-output
   * endpoint and can return a near-miss shape; rejecting anything that fails the schema is what
   * keeps this path as trustworthy as the API one.
   */
  app.post('/api/applications/:jobId/tailoring', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
    if (!job) return reply.code(404).send({ error: 'job not found' });

    const parsed = TailoredApplicationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'tailoring does not match the expected shape', issues: parsed.error.issues });
    }
    const tailoring = parsed.data;
    const candidate = getDefaultCandidate();

    db.prepare(
      `
      INSERT INTO applications (id, job_id, candidate_id, status, draft_headline, draft_summary, draft_bullets_json, tailoring_json)
      VALUES (@id, @jobId, @candidateId, 'drafted', @headline, @summary, @bulletsJson, @tailoringJson)
      ON CONFLICT(job_id, candidate_id) DO UPDATE SET
        draft_headline = excluded.draft_headline,
        draft_summary = excluded.draft_summary,
        draft_bullets_json = excluded.draft_bullets_json,
        tailoring_json = excluded.tailoring_json
    `
    ).run({
      id: newId(),
      jobId: job.id,
      candidateId: candidate.id,
      headline: tailoring.headline,
      summary: tailoring.summary,
      bulletsJson: JSON.stringify(tailoring.bullets.map(bullet => bullet.tailoredText)),
      tailoringJson: JSON.stringify(tailoring),
    });
    logAudit('application', job.id, 'tailored', tailoring.headline);

    const application = db
      .prepare(`SELECT * FROM applications WHERE job_id = ? AND candidate_id = ?`)
      .get(job.id, candidate.id) as ApplicationRow;
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

  /**
   * Pushes the tailored .docx into Telegram.
   *
   * The download route above serves from 127.0.0.1, which only exists on the machine Orbit runs
   * on — so on a phone the digest announces a match the candidate then cannot attach a resume
   * to. Sending the bytes through the bot closes that loop: the file arrives in the chat, Android
   * saves it to Downloads, and the browser's upload picker can reach it.
   */
  app.post('/api/applications/:id/telegram', async (request, reply) => {
    const { id } = request.params as { id: string };
    const application = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(id) as ApplicationRow | undefined;
    if (!application) return reply.code(404).send({ error: 'application not found' });

    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(application.job_id) as JobRow;
    const candidate = getDefaultCandidate();
    const score = db
      .prepare(`SELECT score FROM matches WHERE job_id = ? AND candidate_id = ?`)
      .get(job.id, candidate.id) as { score: number } | undefined;

    const buffer = await buildResumeDocx(application, job, candidate);
    try {
      const delivery = await sendResumeDocument(buffer, resumeFilename(candidate, job), {
        title: job.title,
        company: job.company,
        url: job.url,
        score: score?.score ?? null,
      });
      if (delivery.skipped) return reply.code(409).send({ error: `telegram ${delivery.skipped}`, ...delivery });
      return delivery;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
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
