import { db } from '../db/index.js';
import { newId } from '../util/id.js';
import type { Candidate, JobRow } from '../db/types.js';

export interface MatchResult {
  score: number;
  rationale: string;
  excluded: boolean;
}

/** Pure scoring: skill overlap (60), salary overlap (25), location fit (15); exclusion keywords veto to 0. */
export function scoreJob(job: JobRow, candidate: Candidate): MatchResult {
  for (const exclusion of candidate.exclusions) {
    if (matchesExclusion(job, exclusion)) {
      return { score: 0, rationale: `Excluded: matches "${exclusion}"`, excluded: true };
    }
  }

  const skillsHaystack = `${job.title} ${job.description ?? ''}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (candidate.skills.length > 0) {
    const matchedSkills = candidate.skills.filter(skill => skillsHaystack.includes(skill.toLowerCase()));
    score += Math.round((matchedSkills.length / candidate.skills.length) * 60);
    reasons.push(
      matchedSkills.length > 0
        ? `${matchedSkills.length}/${candidate.skills.length} skills match (${matchedSkills.slice(0, 4).join(', ')})`
        : 'No listed skills found in the posting'
    );
  }

  const salaryFit = salaryOverlap(job.salary_min, job.salary_max, candidate.salaryMin, candidate.salaryMax);
  score += salaryFit.score;
  reasons.push(salaryFit.reason);

  const locationFit = locationMatch(job.location, candidate.locations);
  score += locationFit.score;
  reasons.push(locationFit.reason);

  return { score: Math.max(0, Math.min(100, score)), rationale: reasons.join('; '), excluded: false };
}

const SENIORITY_TERM_RE = /^(level|tier)\s*\d+$/i;

/**
 * "Level 1" / "Tier 1"-style terms are checked against the title only — support/helpdesk
 * postings routinely narrate their *own* multi-tier structure in the description ("mentor
 * Level 1 and Level 2 engineers") even when the posted role itself is senior, so matching
 * the full description produces false positives on exactly the roles worth seeing. Every
 * other exclusion term (unpaid, commission only, india, ...) is self-referential enough to
 * safely check across title + description + location.
 */
function matchesExclusion(job: JobRow, term: string): boolean {
  const trimmed = term.trim();
  if (!trimmed) return false;

  const haystack = SENIORITY_TERM_RE.test(trimmed)
    ? job.title.toLowerCase()
    : `${job.title} ${job.description ?? ''} ${job.location ?? ''}`.toLowerCase();

  return containsWholeWord(haystack, trimmed);
}

/** Word-boundary match so short exclusion terms (e.g. "intern") don't false-positive inside longer words ("international"). */
function containsWholeWord(haystack: string, term: string): boolean {
  const escaped = term.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

function salaryOverlap(
  jobMin: number | null,
  jobMax: number | null,
  candMin: number | null,
  candMax: number | null
): { score: number; reason: string } {
  if (candMin == null && candMax == null) return { score: 15, reason: 'No salary floor set' };
  if (jobMin == null && jobMax == null) return { score: 10, reason: 'Posting has no listed salary' };

  const jLow = jobMin ?? jobMax!;
  const jHigh = jobMax ?? jobMin!;
  const cLow = candMin ?? 0;
  const cHigh = candMax ?? Number.MAX_SAFE_INTEGER;

  const overlaps = jHigh >= cLow && jLow <= cHigh;
  return overlaps
    ? { score: 25, reason: 'Salary range overlaps your target' }
    : { score: 0, reason: 'Salary range is outside your target' };
}

function locationMatch(jobLocation: string | null, candidateLocations: string[]): { score: number; reason: string } {
  if (candidateLocations.length === 0) return { score: 15, reason: 'No location filter set' };
  if (!jobLocation) return { score: 10, reason: 'Posting has no listed location' };

  const loc = jobLocation.toLowerCase();
  const remoteOk = candidateLocations.some(l => l.toLowerCase() === 'remote') && loc.includes('remote');
  const namedMatch = candidateLocations.some(l => l.toLowerCase() !== 'remote' && loc.includes(l.toLowerCase()));

  if (remoteOk || namedMatch) return { score: 15, reason: `Location matches (${jobLocation})` };
  return { score: 0, reason: `Location (${jobLocation}) is outside your target list` };
}

const insertMatch = db.prepare(`
  INSERT OR IGNORE INTO matches (id, job_id, candidate_id, score, rationale)
  VALUES (?, ?, ?, ?, ?)
`);

const unscoredJobs = db.prepare(`
  SELECT j.* FROM jobs j
  LEFT JOIN matches m ON m.job_id = j.id AND m.candidate_id = ?
  WHERE m.id IS NULL
`);

/** Scores every job that doesn't yet have a match row for this candidate. Returns count scored. */
export function matchUnscoredJobs(candidate: Candidate): number {
  const jobs = unscoredJobs.all(candidate.id) as JobRow[];
  let scored = 0;
  for (const job of jobs) {
    const result = scoreJob(job, candidate);
    insertMatch.run(newId(), job.id, candidate.id, result.score, result.rationale);
    scored += 1;
  }
  return scored;
}

const clearMatches = db.prepare(`DELETE FROM matches WHERE candidate_id = ?`);

/** Re-scores every already-ingested job against the current profile — no re-polling of sources. */
export function rescoreAll(candidate: Candidate): number {
  clearMatches.run(candidate.id);
  return matchUnscoredJobs(candidate);
}
