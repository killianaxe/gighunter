import { db } from './index.js';

/**
 * App-level settings (how Orbit behaves), as opposed to the candidate profile (who you are).
 * Stored as text key/value pairs so new settings need no schema change.
 */
export interface AppSettings {
  /** Master switch for the Telegram notifier. */
  notifyEnabled: boolean;
  /** Minimum match score (0-100) that earns a notification. */
  notifyThreshold: number;
  /** Profile skills a posting must mention for full skill credit under flat scoring. */
  skillTarget: number;
  /** Terms from a single skill family a posting must mention for a full domain match. */
  skillFamilyTarget: number;
}

const DEFAULTS: AppSettings = {
  notifyEnabled: false, // opt-in: a fresh install should never message anyone unprompted
  notifyThreshold: 70,
  skillTarget: 5,
  skillFamilyTarget: 4,
};

/** Tuning knobs are clamped rather than rejected — a 0 target would score every job 100%. */
const BOUNDS: Record<string, { min: number; max: number }> = {
  notifyThreshold: { min: 0, max: 100 },
  skillTarget: { min: 1, max: 20 },
  skillFamilyTarget: { min: 1, max: 20 },
};

const readSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`);
const writeSetting = db.prepare(`
  INSERT INTO app_settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

function get(key: string): string | null {
  const row = readSetting.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Guard the null before coercing: Number(null) is 0, not NaN, so an unset numeric setting
 * would otherwise validate as a legitimate 0 (notifying on every job, or dividing by zero).
 */
function num(key: keyof AppSettings): number {
  const raw = get(key);
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULTS[key] as number;
  const { min, max } = BOUNDS[key];
  return Math.min(Math.max(parsed, min), max);
}

export function getAppSettings(): AppSettings {
  return {
    notifyEnabled: get('notifyEnabled') === 'true',
    notifyThreshold: num('notifyThreshold'),
    skillTarget: num('skillTarget'),
    skillFamilyTarget: num('skillFamilyTarget'),
  };
}

export function setAppSettings(settings: Partial<AppSettings>): AppSettings {
  if (settings.notifyEnabled !== undefined) writeSetting.run('notifyEnabled', String(settings.notifyEnabled));
  for (const key of ['notifyThreshold', 'skillTarget', 'skillFamilyTarget'] as const) {
    if (settings[key] !== undefined) writeSetting.run(key, String(settings[key]));
  }
  return getAppSettings();
}

/** Back-compat alias — the notifier only cares about the notification pair. */
export const getNotificationSettings = getAppSettings;
