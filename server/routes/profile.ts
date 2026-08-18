import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getDefaultCandidate } from '../db/candidates.js';
import { logAudit } from '../db/audit.js';
import { rescoreAll } from '../pipeline/match.js';
import { getNotificationSettings, setNotificationSettings } from '../db/settings.js';
import { sendTestMessage } from '../notify/telegram.js';

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
  const notifications = getNotificationSettings();
  return {
    salaryMin: candidate.salaryMin,
    salaryMax: candidate.salaryMax,
    locations: candidate.locations,
    exclusions: candidate.exclusions,
    skills: candidate.skills,
    locationPresets: LOCATION_PRESETS,
    ...notifications,
    // Whether the bot credentials exist at all — lets the UI explain a disabled notifier
    // without ever exposing the token itself.
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
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
      notifyEnabled?: boolean;
      notifyThreshold?: number;
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

    if (body.notifyThreshold !== undefined) {
      const threshold = Number(body.notifyThreshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
        return reply.code(400).send({ error: 'notifyThreshold must be a number between 0 and 100' });
      }
    }

    db.prepare(
      `UPDATE candidates SET salary_min = ?, salary_max = ?, locations_json = ?, exclusions_json = ?, skills_json = ? WHERE id = ?`
    ).run(salaryMin, salaryMax, JSON.stringify(locations), JSON.stringify(exclusions), JSON.stringify(skills), candidate.id);

    setNotificationSettings({
      ...(body.notifyEnabled === undefined ? {} : { notifyEnabled: Boolean(body.notifyEnabled) }),
      ...(body.notifyThreshold === undefined ? {} : { notifyThreshold: Number(body.notifyThreshold) }),
    });

    logAudit('candidate', candidate.id, 'profile_updated');

    const updated = getDefaultCandidate();
    const rescored = rescoreAll(updated);
    return serializeProfile(updated, rescored);
  });

  // Fires a one-off test message so the Telegram wiring can be verified without waiting
  // for a scheduled scan. Does not touch notified_at — this announces nothing real.
  app.post('/api/profile/test-notification', async (_request, reply) => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      return reply.code(400).send({ error: 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in server/.env' });
    }
    try {
      await sendTestMessage();
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
