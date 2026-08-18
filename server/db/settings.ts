import { db } from './index.js';

/**
 * App-level settings (how Orbit behaves), as opposed to the candidate profile (who you are).
 * Stored as text key/value pairs so new settings need no schema change.
 */
export interface NotificationSettings {
  /** Master switch for the Telegram notifier. */
  notifyEnabled: boolean;
  /** Minimum match score (0-100) that earns a notification. */
  notifyThreshold: number;
}

const DEFAULTS: NotificationSettings = {
  notifyEnabled: false, // opt-in: a fresh install should never message anyone unprompted
  notifyThreshold: 70, // mirrors the "strong match" cutoff used in overview.ts and auto/
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

export function getNotificationSettings(): NotificationSettings {
  // Guard the null before coercing: Number(null) is 0, not NaN, so an unset threshold
  // would otherwise validate as a legitimate 0 and notify on literally every job.
  const raw = get('notifyThreshold');
  const threshold = raw === null ? NaN : Number(raw);
  return {
    notifyEnabled: get('notifyEnabled') === 'true',
    notifyThreshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 100 ? threshold : DEFAULTS.notifyThreshold,
  };
}

export function setNotificationSettings(settings: Partial<NotificationSettings>): NotificationSettings {
  if (settings.notifyEnabled !== undefined) writeSetting.run('notifyEnabled', String(settings.notifyEnabled));
  if (settings.notifyThreshold !== undefined) writeSetting.run('notifyThreshold', String(settings.notifyThreshold));
  return getNotificationSettings();
}
