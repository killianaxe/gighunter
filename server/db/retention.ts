import { db } from './index.js';
import { logAudit } from './audit.js';

/**
 * Ages out job postings nobody acted on.
 *
 * Without this the tables only grow: nothing in the pipeline has ever deleted a job, and a scan
 * adds roughly a hundred and sixty a day. A posting also has a natural shelf life — most listings
 * are filled or withdrawn inside a month — so an eighteen-month-old row is not history worth
 * keeping, it is a row the dashboard still renders and the scorer still re-scores on every pass.
 *
 * Set JOB_RETENTION_DAYS=0 to disable.
 */
export const RETENTION_DAYS = (() => {
  const parsed = Number(process.env.JOB_RETENTION_DAYS ?? 60);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60;
})();

export interface PruneResult {
  jobs: number;
  matches: number;
  skippedWithApplications: number;
}

/**
 * A job that has an application is never pruned, at any age.
 *
 * That row is the only record that the candidate went after this posting — the tailoring, the
 * cover letter, the approval, the Telegram delivery timestamp all hang off it. Age is evidence
 * that a posting is stale; it is not evidence that the candidate's own work is disposable. This
 * guard is the reason retention can default to on.
 */
const countProtected = db.prepare(`
  SELECT COUNT(*) AS c FROM jobs j
  WHERE j.created_at < datetime('now', ?)
    AND EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)
`);

const selectPrunable = db.prepare(`
  SELECT j.id FROM jobs j
  WHERE j.created_at < datetime('now', ?)
    AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)
`);

// Children first: foreign_keys is ON and neither reference declares ON DELETE CASCADE, so
// deleting a parent with live children raises a constraint error rather than cascading.
const deleteMatches = db.prepare(`DELETE FROM matches WHERE job_id = ?`);
const deleteJob = db.prepare(`DELETE FROM jobs WHERE id = ?`);

export function pruneOldJobs(days: number = RETENTION_DAYS): PruneResult {
  const empty: PruneResult = { jobs: 0, matches: 0, skippedWithApplications: 0 };
  if (days <= 0) return empty;

  const cutoff = `-${Math.floor(days)} days`;
  const protectedCount = (countProtected.get(cutoff) as { c: number }).c;
  const ids = (selectPrunable.all(cutoff) as { id: string }[]).map(row => row.id);
  if (ids.length === 0) return { ...empty, skippedWithApplications: protectedCount };

  // One transaction: a partial prune that removed matches but not their jobs would leave the
  // dashboard showing postings with no score and no way to get one back short of a rescore.
  const prune = db.transaction((jobIds: string[]) => {
    let matches = 0;
    for (const id of jobIds) {
      matches += deleteMatches.run(id).changes;
      deleteJob.run(id);
    }
    return matches;
  });

  const matches = prune(ids);
  logAudit('retention', 'jobs', 'pruned', `${ids.length} jobs, ${matches} matches older than ${days}d`);
  return { jobs: ids.length, matches, skippedWithApplications: protectedCount };
}
