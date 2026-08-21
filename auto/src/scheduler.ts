import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { ensureOrbitRunning } from './ensure-orbit.js';
import { orbit } from './orbit-client.js';
import { runTailorQueue } from './tailor.js';

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
 * through Gighunter's own Review dialog or an explicit orbit_approve_application tool call.
 */
async function runCycle(): Promise<void> {
  await ensureOrbitRunning();

  const matches = await orbit.getMatches(config.autoDraftThreshold);
  // Select on delivery, not on drafting. Gighunter's notifier drafts every match it announces so
  // the Telegram digest can link a resume that exists, which means "has no application row" no
  // longer means "resume not sent" — filtering on that would find nothing here and quietly end
  // mobile delivery. resumeSentAt is the actual signal.
  const undelivered = matches.filter(m => m.resumeSentAt === null);

  if (undelivered.length === 0) {
    log(`Cycle complete: no undelivered matches at or above ${config.autoDraftThreshold}%.`);
    return;
  }

  /**
   * Phase 1 — make sure every undelivered match has an application row.
   *
   * The cycle runs as three passes rather than one loop because the ordering is load-bearing.
   * The tailoring queue builds its work list from applications that already exist, so drafting
   * has to happen first. And the .docx renders from whatever tailoring is stored at the moment
   * it is downloaded, so tailoring has to finish before the download — otherwise every delivery
   * ships the mechanical keyword draft regardless of how good a tailoring lands a second later.
   */
  const prepared: { match: (typeof undelivered)[number]; applicationId: string }[] = [];

  for (const match of undelivered) {
    try {
      /**
       * Draft ONLY when no application exists yet. Re-drafting an existing one is destructive:
       * draftApplication upserts and overwrites draft_headline / draft_summary /
       * draft_bullets_json (server/pipeline/draft.ts), and orbit_save_tailoring writes the
       * tailored summary and bullets into those same columns — which is what the .docx renders.
       * So re-drafting a tailored application silently replaces real tailoring with the
       * mechanical keyword template, and an approved application with a draft the user never saw.
       *
       * This was safe only while the cycle selected on "not yet drafted", which by definition
       * meant no application existed. Selecting on delivery reaches drafted, tailored and
       * approved rows alike, so the guard has to be explicit.
       */
      const applicationId = match.applicationId ?? (await orbit.draftApplication(match.jobId)).id;
      if (!match.applicationId) {
        log(`Drafted "${match.title}" @ ${match.company} (${match.score}%)`);
      }
      prepared.push({ match, applicationId });
    } catch (err) {
      log(`Failed to prepare "${match.title}" @ ${match.company}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (prepared.length === 0) {
    log('Cycle complete: nothing could be prepared.');
    return;
  }

  /**
   * Phase 2 — write real tailorings, so what gets delivered is the intelligent tier rather than
   * the keyword draft. Bounded per cycle; see config.tailorBatchLimit.
   */
  const tailoring = await runTailorQueue();
  if (tailoring.skipped) {
    log(`Tailoring skipped (${tailoring.skipped}).`);
  } else if (tailoring.summary) {
    log(`Tailoring: ${tailoring.summary}.`);
  }

  /** Phase 3 — render the documents from whatever tailoring now exists, and deliver them. */
  for (const { match, applicationId } of prepared) {
    try {
      const resumePath = await orbit.downloadResume(applicationId);
      log(`Prepared "${match.title}" @ ${match.company} (${match.score}%) → ${resumePath}`);

      // The cover letter is a separate artifact and a separate failure. It is saved even when it
      // is only the deterministic template, because a generic letter that needs one paragraph
      // rewritten still beats sitting down to a blank page — but the tier is logged so a template
      // is never mistaken for a finished letter.
      try {
        const letter = await orbit.downloadCoverLetter(applicationId);
        log(`  → ${letter.source} cover letter → ${letter.path}`);
      } catch (err) {
        log(`  → cover letter skipped: ${err instanceof Error ? err.message : err}`);
      }

      // Delivery is best-effort and deliberately separate from drafting: a Telegram outage,
      // a disabled notifier, or missing credentials must not lose the draft that already
      // succeeded. The resume is on disk either way; this only adds the mobile copy.
      try {
        const sent = await orbit.sendResumeToTelegram(applicationId);
        log(`  → sent ${sent.filename} to Telegram (${sent.bytes} bytes)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`  → Telegram delivery skipped: ${message}`);

        /**
         * A disabled or unconfigured notifier is a standing condition, not a transient failure,
         * and resume_sent_at is only stamped on a successful send. Without this the cycle grinds
         * through every strong match every interval — re-downloading a resume and a cover letter
         * for each — and does so forever, because nothing can ever mark them delivered.
         *
         * A genuine outage still retries: only these two states abandon the cycle, and the
         * remaining matches keep their null resume_sent_at so the next cycle picks them up once
         * the notifier is switched back on.
         */
        if (/telegram (disabled|unconfigured)/i.test(message)) {
          log('Notifier is off — abandoning this cycle rather than re-preparing every match.');
          return;
        }
      }
    } catch (err) {
      log(`Failed to deliver "${match.title}" @ ${match.company}: ${err instanceof Error ? err.message : err}`);
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
