import { db } from '../db/index.js';
import { newId } from '../util/id.js';
import { logAudit } from '../db/audit.js';
import { containsWholeWord, countWholeWordMatches } from '../util/text.js';
import type { Candidate, JobRow, ApplicationRow } from '../db/types.js';

export interface Draft {
  headline: string;
  summary: string;
  bullets: string[];
}

/** Selects/reorders only resume bullets whose keywords appear in the JD — no fabricated content. */
export function buildDraft(job: JobRow, candidate: Candidate): Draft {
  const haystack = `${job.title} ${job.description ?? ''}`.toLowerCase();

  const relevantBullets = candidate.resumeBullets
    .map(bullet => ({ bullet, hits: countWholeWordMatches(haystack, bullet.keywords) }))
    .filter(entry => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map(entry => entry.bullet);

  const chosenBullets = (relevantBullets.length > 0 ? relevantBullets : candidate.resumeBullets).slice(0, 4);
  const matchedSkills = candidate.skills.filter(skill => containsWholeWord(haystack, skill));
  const topSkill = matchedSkills[0] ?? candidate.skills[0] ?? candidate.name;

  const headline = `${candidate.name} — ${topSkill} for ${job.title} at ${job.company}`;
  const summary =
    matchedSkills.length > 0
      ? `${candidate.name} brings direct experience in ${matchedSkills.slice(0, 3).join(', ')}, matching the core requirements of this ${job.title} role at ${job.company}.`
      : `${candidate.name} is applying to the ${job.title} role at ${job.company} based on the experience below.`;

  return { headline, summary, bullets: chosenBullets.map(b => b.text) };
}

const upsertApplication = db.prepare(`
  INSERT INTO applications (id, job_id, candidate_id, status, draft_headline, draft_summary, draft_bullets_json)
  VALUES (@id, @jobId, @candidateId, 'drafted', @headline, @summary, @bulletsJson)
  ON CONFLICT(job_id, candidate_id) DO UPDATE SET
    draft_headline = excluded.draft_headline,
    draft_summary = excluded.draft_summary,
    draft_bullets_json = excluded.draft_bullets_json
`);

const findApplication = db.prepare(`SELECT * FROM applications WHERE job_id = ? AND candidate_id = ?`);

export function draftApplication(job: JobRow, candidate: Candidate): ApplicationRow {
  const draft = buildDraft(job, candidate);
  upsertApplication.run({
    id: newId(),
    jobId: job.id,
    candidateId: candidate.id,
    headline: draft.headline,
    summary: draft.summary,
    bulletsJson: JSON.stringify(draft.bullets),
  });
  logAudit('application', job.id, 'draft', draft.headline);
  return findApplication.get(job.id, candidate.id) as ApplicationRow;
}
