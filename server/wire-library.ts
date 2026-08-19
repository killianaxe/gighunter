import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MinedBullet } from './llm/mine-bullets.js';
import { fingerprint, restatesExisting } from './documents/dedupe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libraryPath = resolve(__dirname, 'data', 'bullet-library.json');
const profilePath = resolve(__dirname, 'profile.json');

interface Bullet {
  text: string;
  keywords: string[];
}
interface Profile {
  resumeBullets: Bullet[];
  workHistory: { company: string; title: string; bullets: Bullet[] }[];
  [key: string]: unknown;
}

const library = JSON.parse(readFileSync(libraryPath, 'utf-8')) as { bullets: MinedBullet[] };
const profile = JSON.parse(readFileSync(profilePath, 'utf-8')) as Profile;

const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * Merges mined bullets into an existing list without displacing what is already there.
 *
 * The hand-written bullets in profile.json were curated by the candidate over years; mining
 * produced breadth, not necessarily better phrasing. Existing entries keep their position and
 * wording, and only genuinely new material is appended.
 */
function merge(existing: Bullet[], incoming: MinedBullet[]): { bullets: Bullet[]; added: number } {
  const seen = new Set(existing.map(bullet => key(bullet.text)));
  const fingerprints = existing.map(bullet => fingerprint(bullet.text));
  const texts = existing.map(bullet => bullet.text);
  const bullets = [...existing];
  let added = 0;
  for (const bullet of incoming) {
    const id = key(bullet.text);
    if (seen.has(id) || restatesExisting(bullet.text, fingerprints, texts)) continue;
    seen.add(id);
    fingerprints.push(fingerprint(bullet.text));
    texts.push(bullet.text);
    bullets.push({ text: bullet.text, keywords: bullet.keywords });
    added += 1;
  }
  return { bullets, added };
}

const byEmployer = new Map<string, MinedBullet[]>();
for (const bullet of library.bullets) {
  if (bullet.employer === 'UNRESOLVED') continue;
  const list = byEmployer.get(bullet.employer) ?? [];
  list.push(bullet);
  byEmployer.set(bullet.employer, list);
}

// Roles that exist in the work history receive their own bullets — resume.ts prints these
// under the employer heading, ranked against the job description, top N per role.
const roleCompanies = new Set(profile.workHistory.map(entry => entry.company));
let intoRoles = 0;
for (const entry of profile.workHistory) {
  const incoming = byEmployer.get(entry.company) ?? [];
  // Metric-bearing bullets first: rankBullets breaks ties by original order, so a bullet with
  // a hard number outranks a vague one when both match the posting equally.
  incoming.sort((a, b) => Number(b.hasMetrics) - Number(a.hasMetrics));
  const result = merge(entry.bullets, incoming);
  entry.bullets = result.bullets;
  intoRoles += result.added;
  console.log(`  ${entry.company}: ${entry.bullets.length} bullets (+${result.added})`);
}

// Everything else is earlier-career work and client engagements. Those roles live in
// additionalExperience as one-liners, so their bullets go to the flat pool where draft.ts and
// tailoring can still select them — they simply don't print under a dated role heading.
const unmapped = [...byEmployer.entries()]
  .filter(([company]) => !roleCompanies.has(company))
  .flatMap(([, bullets]) => bullets)
  .sort((a, b) => Number(b.hasMetrics) - Number(a.hasMetrics));

const pool = merge(profile.resumeBullets, unmapped);
profile.resumeBullets = pool.bullets;

if (!existsSync(`${profilePath}.bak`)) copyFileSync(profilePath, `${profilePath}.bak`);
writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

console.log(`\nworkHistory bullets added : ${intoRoles}`);
console.log(`resumeBullets pool        : ${profile.resumeBullets.length} (+${pool.added})`);
console.log(`wrote ${profilePath} (backup at profile.json.bak)`);
