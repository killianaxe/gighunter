import './env.js';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/index.js';
import { newId } from './util/id.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profilePath = resolve(__dirname, 'profile.json');
const profileExamplePath = resolve(__dirname, 'profile.example.json');

if (!existsSync(profilePath)) {
  copyFileSync(profileExamplePath, profilePath);
  console.log('Created server/profile.json from the template — edit it with your real details, then re-run npm run seed.');
}

interface ProfileFile {
  name: string;
  skills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  locations: string[];
  exclusions: string[];
  resumeBullets: { text: string; keywords: string[] }[];
  email?: string;
  phone?: string;
  linkedin?: string;
  homeLocation?: string;
  certifications?: string[];
  education?: { degree: string; school: string; years: string }[];
  workHistory?: {
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string | null;
    bullets: { text: string; keywords: string[] }[];
  }[];
  additionalExperience?: string[];
}

const profile = JSON.parse(readFileSync(profilePath, 'utf-8')) as ProfileFile;
const defaultUserId = process.env.DEFAULT_USER_ID ?? 'default-user';

const existingCandidate = db.prepare(`SELECT id FROM candidates WHERE id = ?`).get(defaultUserId);

const resumeDetailArgs = [
  profile.email ?? null,
  profile.phone ?? null,
  profile.linkedin ?? null,
  profile.homeLocation ?? null,
  JSON.stringify(profile.certifications ?? []),
  JSON.stringify(profile.education ?? []),
  JSON.stringify(profile.workHistory ?? []),
  JSON.stringify(profile.additionalExperience ?? []),
];

if (existingCandidate) {
  db.prepare(
    `
    UPDATE candidates SET
      name = ?, skills_json = ?, salary_min = ?, salary_max = ?,
      locations_json = ?, exclusions_json = ?, resume_bullets_json = ?,
      email = ?, phone = ?, linkedin = ?, home_location = ?,
      certifications_json = ?, education_json = ?, work_history_json = ?, additional_experience_json = ?
    WHERE id = ?
  `
  ).run(
    profile.name,
    JSON.stringify(profile.skills),
    profile.salaryMin,
    profile.salaryMax,
    JSON.stringify(profile.locations),
    JSON.stringify(profile.exclusions),
    JSON.stringify(profile.resumeBullets),
    ...resumeDetailArgs,
    defaultUserId
  );
  console.log(`Updated candidate profile for ${profile.name} (${defaultUserId}).`);
} else {
  db.prepare(
    `
    INSERT INTO candidates (
      id, name, skills_json, salary_min, salary_max, locations_json, exclusions_json, resume_bullets_json,
      email, phone, linkedin, home_location, certifications_json, education_json, work_history_json, additional_experience_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    defaultUserId,
    profile.name,
    JSON.stringify(profile.skills),
    profile.salaryMin,
    profile.salaryMax,
    JSON.stringify(profile.locations),
    JSON.stringify(profile.exclusions),
    JSON.stringify(profile.resumeBullets),
    ...resumeDetailArgs
  );
  console.log(`Created candidate profile for ${profile.name} (${defaultUserId}).`);
}

const defaultQuery = profile.skills[0] ?? 'remote';

const insertSource = db.prepare(
  `INSERT INTO sources (id, name, type, query_or_url, cadence_minutes, enabled) VALUES (?, ?, ?, ?, 120, 1)`
);

// Remotive and Himalayas both need no API key, so they're the only sources seeded
// automatically — Adzuna/USAJOBS require credentials the user has to register for.
for (const type of ['remotive', 'himalayas'] as const) {
  const existingSource = db.prepare(`SELECT id FROM sources WHERE type = ? LIMIT 1`).get(type);
  if (!existingSource) {
    insertSource.run(newId(), `${type}: ${defaultQuery}`, type, defaultQuery);
    console.log(`Seeded a ${type} source for "${defaultQuery}".`);
  }
}

console.log(
  'Add more sources from the Sources panel, or edit server/profile.json and re-run npm run seed to change your default search term.'
);
console.log('Seed complete.');
