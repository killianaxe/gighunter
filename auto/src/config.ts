import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const envPath = resolve(projectRoot, '.env');

if (existsSync(envPath)) {
  const contents = readFileSync(envPath, 'utf-8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function str(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

function num(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  orbitBaseUrl: str(process.env.ORBIT_BASE_URL, 'http://127.0.0.1:3000'),
  orbitProjectDir: str(process.env.ORBIT_PROJECT_DIR, resolve(projectRoot, '..')),
  autoStartOrbit: bool(process.env.AUTO_START_ORBIT, true),
  autoDraftIntervalMinutes: num(process.env.AUTO_DRAFT_INTERVAL_MINUTES, 15),
  autoDraftThreshold: num(process.env.AUTO_DRAFT_THRESHOLD, 70),
  resumeDownloadDir: resolve(projectRoot, str(process.env.RESUME_DOWNLOAD_DIR, './downloads')),
  logsDir: resolve(projectRoot, 'logs'),

  /**
   * Whether each cycle runs the tailoring queue before it downloads and delivers.
   *
   * On by default: without it the scheduler ships the deterministic keyword draft forever, and
   * the whole MCP-over-Pro route only ever fires when someone runs a script by hand. Set
   * AUTO_TAILOR=false to fall back to that older behaviour.
   */
  autoTailor: bool(process.env.AUTO_TAILOR, true),
  /** Concurrent headless Claude sessions. Each is one posting; the work is embarrassingly parallel. */
  tailorConcurrency: num(process.env.TAILOR_JOBS, 4),
  /**
   * Most applications tailored per cycle. Pro allowance is windowed, so a large backlog drains
   * over several cycles instead of burning the window in one burst.
   */
  tailorBatchLimit: num(process.env.TAILOR_BATCH_LIMIT, 10),
  tailorTimeoutMinutes: num(process.env.TAILOR_TIMEOUT_MINUTES, 30),
};
