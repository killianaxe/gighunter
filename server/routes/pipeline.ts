import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';

interface PipelineRow {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  salaryMin: number | null;
  salaryMax: number | null;
  postedAt: string | null;
  score: number | null;
  rationale: string | null;
  applicationId: string | null;
  applicationStatus: 'drafted' | 'approved' | null;
}

const STAGES = ['new', 'matched', 'drafted', 'approved'] as const;
type Stage = (typeof STAGES)[number];

function stageFor(row: PipelineRow): Stage {
  if (row.applicationStatus === 'approved') return 'approved';
  if (row.applicationStatus === 'drafted') return 'drafted';
  if (row.score !== null) return 'matched';
  return 'new';
}

export async function pipelineRoutes(app: FastifyInstance) {
  // The same source -> normalize -> match -> draft -> approve flow as server/pipeline/*, just
  // bucketed by where each job currently sits instead of flattened into one ranked list.
  app.get('/api/pipeline', async () => {
    const candidate = getDefaultCandidate();
    const rows = db
      .prepare(
        `
        SELECT j.id AS jobId, j.title, j.company, j.location, j.url,
               j.salary_min AS salaryMin, j.salary_max AS salaryMax, j.posted_at AS postedAt,
               m.score, m.rationale,
               a.id AS applicationId, a.status AS applicationStatus
        FROM jobs j
        LEFT JOIN matches m ON m.job_id = j.id AND m.candidate_id = ?
        LEFT JOIN applications a ON a.job_id = j.id AND a.candidate_id = ?
        ORDER BY j.created_at DESC
      `
      )
      .all(candidate.id, candidate.id) as PipelineRow[];

    const stages: Record<Stage, PipelineRow[]> = { new: [], matched: [], drafted: [], approved: [] };
    for (const row of rows) stages[stageFor(row)].push(row);

    const counts = Object.fromEntries(STAGES.map(stage => [stage, stages[stage].length])) as Record<Stage, number>;
    return { stages, counts };
  });
}
