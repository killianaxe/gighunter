import { db } from '../db/index.js';
import { newId } from '../util/id.js';
import { getAppSettings } from '../db/settings.js';
import { containsWholeWord, countWholeWordMatches } from '../util/text.js';
import type { Candidate, JobRow } from '../db/types.js';

export interface MatchResult {
  score: number;
  rationale: string;
  excluded: boolean;
}

/**
 * The two scoring denominators, both tunable live from Agent settings.
 *
 * `skillTarget` — how many profile skills earn full flat credit. Scoring against the *entire*
 * list punishes a broad profile: 12 skills spanning virtualization, identity, and security
 * never co-occur in one posting, so "VMware Engineer" scored 2/12 and landed at 50%.
 *
 * `skillFamilyTarget` — how many terms from one family earn a full domain match, so a
 * specialist posting isn't marked down for ignoring unrelated parts of the profile.
 */
export interface ScoringTargets {
  skillTarget: number;
  skillFamilyTarget: number;
}

/**
 * Skills grouped by the role they belong to, so a posting is judged against its own domain
 * rather than the whole profile. A "VMware Engineer" posting should not be marked down for
 * omitting Entra ID; matching four virtualization terms is a complete match for that job.
 *
 * Drawn from the candidate's actual history (VCP tracks, VMware SRM disaster recovery, Entra/
 * Intune tenant administration, CrowdStrike and pentest work, PowerShell tooling, and the
 * recent LLM/RAG work), not from a generic taxonomy. Edit freely — families are additive.
 */
const SKILL_FAMILIES: Record<string, string[]> = {
  virtualization: ['vmware', 'vsphere', 'esxi', 'vcenter', 'site recovery manager', 'horizon view', 'vrealize', 'virtualization', 'vdi', 'hypervisor', 'nsx'],
  identity: ['active directory', 'entra id', 'azure ad', 'conditional access', 'single sign-on', 'saml', 'mfa', 'identity and access', 'entra connect', 'ldap', 'okta'],
  endpoint: ['intune', 'autopilot', 'microsoft 365', 'office 365', 'o365', 'exchange online', 'mdm', 'sccm', 'jamf'],
  cloud: ['azure', 'aws', 'ec2', 'iaas', 'landing zone', 'cloudformation', 'vpc'],
  security: ['penetration testing', 'pentest', 'crowdstrike', 'xdr', 'edr', 'vulnerability assessment', 'siem', 'incident response', 'ethical hacking', 'soc analyst'],
  automation: ['powershell', 'python', 'ansible', 'terraform', 'bash scripting', 'ci/cd'],
  disasterRecovery: ['disaster recovery', 'business continuity', 'rpo', 'rto', 'failover', 'site recovery'],
  linux: ['linux', 'rhel', 'ubuntu', 'centos', 'red hat'],
  ai: ['llm', 'rag', 'machine learning', 'ollama', 'prompt engineering', 'mlops', 'pytorch', 'tensorflow'],
};

/** Best-matching family for a posting — the job effectively selects its own domain. */
function bestFamilyMatch(haystack: string, target: number): { name: string; matched: number; fraction: number } {
  let best = { name: '', matched: 0, fraction: 0 };
  for (const [name, terms] of Object.entries(SKILL_FAMILIES)) {
    // Whole-word, not substring: "storage" contains "rag" and would otherwise score every
    // storage-heavy infrastructure posting as an AI match. See util/text.ts.
    const matched = countWholeWordMatches(haystack, terms);
    const fraction = Math.min(matched / Math.min(target, terms.length), 1);
    if (fraction > best.fraction) best = { name, matched, fraction };
  }
  return best;
}

/** Pure scoring: skill overlap (60), salary overlap (25), location fit (15); exclusion keywords veto to 0. */
export function scoreJob(job: JobRow, candidate: Candidate, targets: ScoringTargets = getAppSettings()): MatchResult {
  for (const exclusion of candidate.exclusions) {
    if (matchesExclusion(job, exclusion)) {
      return { score: 0, rationale: `Excluded: matches "${exclusion}"`, excluded: true };
    }
  }

  const skillsHaystack = `${job.title} ${job.description ?? ''}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  // The better of two views: the flat profile list (so editing Skills in settings still
  // matters) and the best-matching family (so a specialist posting isn't marked down for
  // ignoring unrelated parts of the profile). Whichever fits the posting better wins.
  const matchedSkills = candidate.skills.filter(skill => containsWholeWord(skillsHaystack, skill));
  const flatFraction =
    candidate.skills.length > 0
      ? Math.min(matchedSkills.length / Math.min(targets.skillTarget, candidate.skills.length), 1)
      : 0;
  const family = bestFamilyMatch(skillsHaystack, targets.skillFamilyTarget);

  score += Math.round(Math.max(flatFraction, family.fraction) * 60);

  if (family.fraction >= flatFraction && family.matched > 0) {
    reasons.push(`${family.matched} ${family.name} skills matched (${Math.round(family.fraction * 100)}% of a full domain match)`);
  } else if (matchedSkills.length > 0) {
    reasons.push(`${matchedSkills.length} profile skills matched (${matchedSkills.slice(0, 4).join(', ')})`);
  } else {
    reasons.push('No listed skills found in the posting');
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
  // Read the tuning knobs once, not once per job — a rescore covers hundreds of rows.
  const targets = getAppSettings();
  let scored = 0;
  for (const job of jobs) {
    const result = scoreJob(job, candidate, targets);
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
