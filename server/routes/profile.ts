import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';
import { logAudit } from '../db/audit.js';
import { rescoreAll } from '../pipeline/match.js';

// Mirrors profile.json's `_locationPresets_editToActivate` — quick-add suggestions for the
// Settings UI. Not stored anywhere; purely a fixed convenience list.
const LOCATION_PRESETS = [
  'Fort Smith, AR',
  'Denver, CO',
  'Dallas, TX',
  'Birmingham, AL',
  'San Francisco, CA',
  'New Orleans, LA',
  'Phoenix, AZ',
  'Las Vegas, NV',
];

function cleanStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every(v => typeof v === 'string')) return null;
  const cleaned = value.map(v => v.trim()).filter(Boolean);
  return [...new Set(cleaned)];
}

function serializeProfile(candidate: ReturnType<typeof getDefaultCandidate>, rescored?: number) {
  return {
    salaryMin: candidate.salaryMin,
    salaryMax: candidate.salaryMax,
    locations: candidate.locations,
    exclusions: candidate.exclusions,
    skills: candidate.skills,
    locationPresets: LOCATION_PRESETS,
    ...(rescored === undefined ? {} : { rescored }),
  };
}

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/profile', async () => {
    return serializeProfile(getDefaultCandidate());
  });

  app.patch('/api/profile', async (request, reply) => {
    const candidate = getDefaultCandidate();
    const body = (request.body ?? {}) as {
      salaryMin?: number | null;
      salaryMax?: number | null;
      locations?: unknown;
      exclusions?: unknown;
      skills?: unknown;
    };

    const salaryMin = 'salaryMin' in body ? body.salaryMin ?? null : candidate.salaryMin;
    const salaryMax = 'salaryMax' in body ? body.salaryMax ?? null : candidate.salaryMax;
    if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
      return reply.code(400).send({ error: 'salaryMin cannot be greater than salaryMax' });
    }

    const locations = 'locations' in body ? cleanStringList(body.locations) : candidate.locations;
    const exclusions = 'exclusions' in body ? cleanStringList(body.exclusions) : candidate.exclusions;
    const skills = 'skills' in body ? cleanStringList(body.skills) : candidate.skills;
    if (locations === null || exclusions === null || skills === null) {
      return reply.code(400).send({ error: 'locations, exclusions, and skills must each be arrays of strings' });
    }

    db.prepare(
      `UPDATE candidates SET salary_min = ?, salary_max = ?, locations_json = ?, exclusions_json = ?, skills_json = ? WHERE id = ?`
    ).run(salaryMin, salaryMax, JSON.stringify(locations), JSON.stringify(exclusions), JSON.stringify(skills), candidate.id);

    logAudit('candidate', candidate.id, 'profile_updated');

    const updated = getDefaultCandidate();
    const rescored = rescoreAll(updated);
    return serializeProfile(updated, rescored);
  });
}
