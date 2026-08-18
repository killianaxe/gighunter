import { db } from './index.js';
import { candidateFromRow } from './types.js';
import type { Candidate, CandidateRow } from './types.js';

const getCandidateRow = db.prepare(`SELECT * FROM candidates WHERE id = ?`);

export function getDefaultCandidate(): Candidate {
  const defaultUserId = process.env.DEFAULT_USER_ID ?? 'default-user';
  const row = getCandidateRow.get(defaultUserId) as CandidateRow | undefined;
  if (!row) {
    throw new Error('No candidate profile found — run `npm run seed` first.');
  }
  return candidateFromRow(row);
}
