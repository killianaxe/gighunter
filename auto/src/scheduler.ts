import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { ensureOrbitRunning } from './ensure-orbit.js';
import { orbit } from './orbit-client.js';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function log(line: string): void {
  const stamp = new Date().toISOString();
  const message = `[${stamp}] ${line}`;
  console.log(message);

  mkdirSync(config.logsDir, { recursive: true });
  const logFile = resolve(config.logsDir, `${stamp.slice(0, 10)}.log`);
  appendFileSync(logFile, message + '\n');
}

/**
 * Finds strong matches with no draft yet and auto-drafts them (tailored highlights +
 * a saved .docx resume). Never approves — that stays a deliberate, manual step, either
 * through Orbit's own Review dialog or an explicit orbit_approve_application tool call.
 */
async function runCycle(): Promise<void> {
  await ensureOrbitRunning();

  const matches = await orbit.getMatches(config.autoDraftThreshold);
  const undrafted = matches.filter(m => m.applicationStatus === null);

  if (undrafted.length === 0) {
    log(`Cycle complete: no new matches at or above ${config.autoDraftThreshold}%.`);
    return;
  }

  for (const match of undrafted) {
    try {
      const application = await orbit.draftApplication(match.jobId);
      const resumePath = await orbit.downloadResume(application.id);
      log(`Auto-drafted "${match.title}" @ ${match.company} (${match.score}%) → ${resumePath}`);
    } catch (err) {
      log(`Failed to auto-draft "${match.title}" @ ${match.company}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  log(
    `autogighunter scheduler starting — checking every ${config.autoDraftIntervalMinutes}m for matches >= ${config.autoDraftThreshold}%.`
  );

  // Run once immediately, then on the configured interval, forever.
  for (;;) {
    try {
      await runCycle();
    } catch (err) {
      log(`Cycle failed: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(config.autoDraftIntervalMinutes * 60_000);
  }
}

main();
