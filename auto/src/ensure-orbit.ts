import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';

async function isOrbitUp(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${config.orbitBaseUrl}/api/overview`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function startOrbit(): void {
  mkdirSync(config.logsDir, { recursive: true });
  const logPath = resolve(config.logsDir, 'orbit-server.log');
  const out = openSync(logPath, 'a');
  const err = openSync(logPath, 'a');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: config.orbitProjectDir,
    detached: true,
    stdio: ['ignore', out, err],
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Checks Gighunter's health; auto-starts it via WSL if configured and waits for it to come up. */
export async function ensureOrbitRunning(): Promise<void> {
  if (await isOrbitUp()) return;

  if (!config.autoStartOrbit) {
    throw new Error(
      `Gighunter isn't running at ${config.orbitBaseUrl}. Start it with "npm run dev" in gighunter, or set AUTO_START_ORBIT=true.`
    );
  }

  startOrbit();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (await isOrbitUp()) return;
  }

  throw new Error(`Timed out waiting for Gighunter to come up at ${config.orbitBaseUrl} after auto-start.`);
}
