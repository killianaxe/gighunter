export interface CandidateRow {
  id: string;
  name: string;
  headline: string | null;
  skills_json: string;
  salary_min: number | null;
  salary_max: number | null;
  locations_json: string;
  exclusions_json: string;
  resume_bullets_json: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  home_location: string | null;
  certifications_json: string;
  education_json: string;
  work_history_json: string;
  additional_experience_json: string;
  created_at: string;
}

export interface Candidate {
  id: string;
  name: string;
  /** Stable professional tagline under the name — identity, not per-job positioning. */
  headline: string | null;
  skills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  locations: string[];
  exclusions: string[];
  resumeBullets: ResumeBullet[];
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  homeLocation: string | null;
  certifications: string[];
  education: EducationEntry[];
  workHistory: WorkHistoryEntry[];
  additionalExperience: string[];
}

export interface ResumeBullet {
  text: string;
  keywords: string[];
}

export interface WorkHistoryBullet {
  text: string;
  keywords: string[];
}

export interface WorkHistoryEntry {
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string | null;
  bullets: WorkHistoryBullet[];
}

export interface EducationEntry {
  degree: string;
  school: string;
  years: string;
}

export function candidateFromRow(row: CandidateRow): Candidate {
  return {
    id: row.id,
    name: row.name,
    headline: row.headline,
    skills: JSON.parse(row.skills_json),
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    locations: JSON.parse(row.locations_json),
    exclusions: JSON.parse(row.exclusions_json),
    resumeBullets: JSON.parse(row.resume_bullets_json),
    email: row.email,
    phone: row.phone,
    linkedin: row.linkedin,
    homeLocation: row.home_location,
    certifications: JSON.parse(row.certifications_json),
    education: JSON.parse(row.education_json),
    workHistory: JSON.parse(row.work_history_json),
    additionalExperience: JSON.parse(row.additional_experience_json),
  };
}

export const SOURCE_TYPES = [
  'remotive', 'rss', 'adzuna', 'himalayas', 'usajobs',
  'remoteok', 'arbeitnow', 'jobicy', 'themuse', 'jooble',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface SourceRow {
  id: string;
  name: string;
  type: SourceType;
  query_or_url: string;
  cadence_minutes: number;
  enabled: number;
  last_polled_at: string | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  source_id: string;
  external_id: string | null;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  url: string;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: string | null;
  normalized_key: string;
  /** When the candidate dismissed this posting; null means it is still in play. */
  dismissed_at: string | null;
  created_at: string;
}

export interface MatchRow {
  id: string;
  job_id: string;
  candidate_id: string;
  score: number;
  rationale: string;
  created_at: string;
}

export interface ApplicationRow {
  id: string;
  job_id: string;
  candidate_id: string;
  status: 'drafted' | 'approved';
  draft_headline: string | null;
  draft_summary: string | null;
  draft_bullets_json: string;
  tailoring_json: string | null;
  /** When the tailored .docx was last pushed to Telegram; null means never. */
  resume_sent_at: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface NormalizedListing {
  externalId: string | null;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  url: string;
  salaryMin: number | null;
  salaryMax: number | null;
  postedAt: string | null;
}
