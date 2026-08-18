import { db } from './db/index.js';
import { pollSources } from './pipeline/poll.js';
import { matchUnscoredJobs } from './pipeline/match.js';
import { getDefaultCandidate } from './db/candidates.js';
import type { SourceRow } from './db/types.js';

const CHECK_INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

function dueSources(): SourceRow[] {
  return db
    .prepare(
      `
    SELECT * FROM sources
    WHERE enabled = 1
      AND (
        last_polled_at IS NULL
        OR datetime(last_polled_at, '+' || cadence_minutes || ' minutes') <= datetime('now')
      )
  `
    )
    .all() as SourceRow[];
}

async function runDueScan(): Promise<void> {
  const sources = dueSources();
  if (sources.length === 0) return;

  try {
    await pollSources(sources);
    matchUnscoredJobs(getDefaultCandidate());
  } catch (err) {
    console.error('Scheduled scan failed:', err instanceof Error ? err.message : err);
  }
}

/** Background scan loop — checks every minute for any source whose cadence has elapsed. */
export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runDueScan();
  }, CHECK_INTERVAL_MS);
  timer.unref();
}

export function nextScanTime(): string | null {
  const row = db
    .prepare(
      `
    SELECT MIN(
      CASE
        WHEN last_polled_at IS NULL THEN datetime('now')
        ELSE datetime(last_polled_at, '+' || cadence_minutes || ' minutes')
      END
    ) AS next
    FROM sources
    WHERE enabled = 1
  `
    )
    .get() as { next: string | null };
  return row.next;
}
