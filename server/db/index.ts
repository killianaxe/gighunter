import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  migrateSourcesTable,
  migrateCandidatesColumns,
  migrateJobsColumns,
  migrateApplicationsColumns,
} from './migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, '..');

const rawPath = process.env.DATABASE_PATH ?? './data/orbit.db';
const dbPath = isAbsolute(rawPath) ? rawPath : resolve(serverDir, rawPath);

if (!existsSync(dirname(dbPath))) {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);
migrateSourcesTable(db);
migrateCandidatesColumns(db);
migrateJobsColumns(db);
migrateApplicationsColumns(db);
