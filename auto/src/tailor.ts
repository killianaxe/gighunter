import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.js';

const execFileAsync = promisify(execFile);

const SCRIPT = resolve(config.orbitProjectDir, 'auto/tailor-queue.sh');

export interface TailorOutcome {
  ran: boolean;
  /** Why the run was skipped, when it was. */
  skipped: 'disabled' | 'no-script' | 'nothing-to-do' | null;
  tailored: number;
  failed: number;
  summary: string;
}

/** "Done: 7 tailored, 1 failed." — the script's own last word on the run. */
const DONE_LINE = /Done:\s*(\d+)\s*tailored,\s*(\d+)\s*failed/;
const NOTHING_LINE = /Nothing to tailor/;

/**
 * Runs the tailoring queue: headless Claude Code sessions that read each posting and write a real
 * tailoring — resume bullets and cover letter — back into Gighunter over MCP.
 *
 * This is what separates the two tiers the pipeline can deliver. Without it the scheduler ships
 * the deterministic keyword draft forever: accurate, but visibly mechanical, and generic in the
 * cover letter's why-this-company paragraph. Running it here means the good tier happens on a
 * schedule rather than only when someone remembers to run a script.
 *
 * Bounded on purpose. Each unit of work is a Claude session against a windowed Pro allowance, so
 * a 200-match backlog must not become 200 sessions in one cycle — it becomes `tailorBatchLimit`
 * per cycle, and the backlog drains over several. Raising the cap trades window headroom for
 * drain rate; that is a deliberate knob, not a default.
 */
export async function runTailorQueue(): Promise<TailorOutcome> {
  const idle: TailorOutcome = { ran: false, skipped: null, tailored: 0, failed: 0, summary: '' };

  if (!config.autoTailor) return { ...idle, skipped: 'disabled' };
  if (!existsSync(SCRIPT)) return { ...idle, skipped: 'no-script' };

  let stdout = '';
  try {
    const result = await execFileAsync('bash', [SCRIPT, String(config.tailorBatchLimit)], {
      cwd: config.orbitProjectDir,
      env: {
        ...process.env,
        ORBIT_BASE_URL: config.orbitBaseUrl,
        TAILOR_JOBS: String(config.tailorConcurrency),
      },
      // A full batch is several rounds of Claude sessions. The cycle awaits this before sleeping,
      // so a long run delays the next cycle rather than overlapping with it.
      timeout: config.tailorTimeoutMinutes * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    // A non-zero exit still carries the transcript, and individual job failures are already
    // counted by the script itself — so parse what came back before treating this as fatal.
    stdout = (err as { stdout?: string }).stdout ?? '';
    if (!DONE_LINE.test(stdout)) {
      const message = err instanceof Error ? err.message : String(err);
      return { ...idle, ran: true, summary: `tailoring run failed: ${message}` };
    }
  }

  if (NOTHING_LINE.test(stdout)) return { ...idle, skipped: 'nothing-to-do' };

  const match = stdout.match(DONE_LINE);
  if (!match) return { ...idle, ran: true, summary: 'tailoring run produced no summary line' };

  const tailored = Number(match[1]);
  const failed = Number(match[2]);
  return {
    ran: true,
    skipped: null,
    tailored,
    failed,
    summary: `tailored ${tailored}, failed ${failed}`,
  };
}
