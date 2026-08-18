import { db } from '../db/index.js';
import { getNotificationSettings } from '../db/settings.js';
import { logAudit } from '../db/audit.js';

export interface NotifiableMatch {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  salaryMin: number | null;
  salaryMax: number | null;
  score: number;
}

export interface NotifyResult {
  sent: number;
  skipped: 'disabled' | 'unconfigured' | 'nothing-new' | null;
  error: string | null;
}

/** Strong matches that have never been announced. See schema.sql for why the flag lives on jobs. */
const unnotifiedStrongMatches = db.prepare(`
  SELECT j.id AS jobId, j.title, j.company, j.location, j.url,
         j.salary_min AS salaryMin, j.salary_max AS salaryMax, m.score
  FROM matches m
  JOIN jobs j ON j.id = m.job_id
  WHERE m.candidate_id = ?
    AND m.score >= ?
    AND j.notified_at IS NULL
  ORDER BY m.score DESC
`);

const markNotified = db.prepare(`UPDATE jobs SET notified_at = datetime('now') WHERE id = ?`);

function formatSalary(min: number | null, max: number | null): string | null {
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  if (min && max && min !== max) return `${k(min)}–${k(max)}`;
  if (min || max) return k((min || max)!);
  return null;
}

/**
 * Plain text, not Markdown/HTML: job titles routinely contain characters Telegram's
 * parsers treat as markup (*, _, [, ]), and one unescaped bracket fails the whole send.
 * Bare URLs still auto-link in plain text, which is all the formatting that matters here.
 */
export function formatDigest(matches: NotifiableMatch[]): string {
  const header = `🛰 Orbit found ${matches.length} strong match${matches.length === 1 ? '' : 'es'}`;
  const blocks = matches.map(m => {
    const meta = [formatSalary(m.salaryMin, m.salaryMax), m.location].filter(Boolean).join(' · ');
    return [`${m.score}% · ${m.title} — ${m.company}`, meta, m.url].filter(Boolean).join('\n');
  });
  return [header, ...blocks].join('\n\n');
}

async function sendMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { description?: string } | null;
    throw new Error(body?.description ?? `Telegram responded ${res.status}`);
  }
}

/** One-off connectivity check. Throws with Telegram's own error text so the UI can show it. */
export async function sendTestMessage(): Promise<void> {
  await sendMessage('🛰 Orbit test message — your Telegram notifier is connected.');
}

/**
 * Announces any un-notified matches at or above the configured threshold, as ONE batched
 * message. Jobs are only flagged as notified after a successful send, so a Telegram outage
 * defers the announcement to the next scan rather than losing it.
 */
export async function notifyStrongMatches(candidateId: string): Promise<NotifyResult> {
  const { notifyEnabled, notifyThreshold } = getNotificationSettings();
  if (!notifyEnabled) return { sent: 0, skipped: 'disabled', error: null };

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return { sent: 0, skipped: 'unconfigured', error: null };
  }

  const matches = unnotifiedStrongMatches.all(candidateId, notifyThreshold) as NotifiableMatch[];
  if (matches.length === 0) return { sent: 0, skipped: 'nothing-new', error: null };

  try {
    await sendMessage(formatDigest(matches));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logAudit('notify', candidateId, 'telegram_error', message);
    return { sent: 0, skipped: null, error: message };
  }

  const flagAll = db.transaction((rows: NotifiableMatch[]) => {
    for (const row of rows) markNotified.run(row.jobId);
  });
  flagAll(matches);

  logAudit('notify', candidateId, 'telegram_sent', `${matches.length} matches at >= ${notifyThreshold}%`);
  return { sent: matches.length, skipped: null, error: null };
}
