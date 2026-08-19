import type { ExtractedDocument } from './extract-text.js';

export interface EmployerAlias {
  canonical: string;
  /** Lowercase fragments that identify this employer in a resume heading. */
  aliases: string[];
}

/**
 * Employer identities, canonical name first. Mining ran in batches of 60 blocks, so a heading in
 * one batch and its bullets in the next produced both blank employers and a dozen spellings of
 * the same company. This table is the single place those identities are reconciled.
 */
export const EMPLOYERS: EmployerAlias[] = [
  { canonical: 'Red Shift Cybersecurity LLC', aliases: ['red shift', 'redshift cyber'] },
  { canonical: 'Kirkham IronTech Security', aliases: ['kirkham'] },
  { canonical: 'Intras Cloud Services', aliases: ['intras'] },
  // "Managed Services Provider" is how several drafts anonymise this role; its Sept 2019 – Jul 2021
  // span matches NetStandard in profile.json exactly.
  { canonical: 'NetStandard', aliases: ['netstandard', 'managed services provider'] },
  {
    canonical: 'SMB Technology Solutions (VMware / Johnson & Johnson)',
    aliases: ['smb technology', 'johnson & johnson', 'johnson and johnson', 'jnj'],
  },
  { canonical: 'More Solutions Group – Catalent Pharmaceuticals', aliases: ['more solutions group', 'catalent'] },
  { canonical: 'Community Health Systems', aliases: ['community health systems'] },
  { canonical: 'VSS, Inc.', aliases: ['vss', 'vanguard health'] },
  { canonical: 'Buchanan Associates', aliases: ['buchanan'] },
  {
    canonical: 'ProTech Solutions – Cadbury Schweppes Dr. Pepper 7-Up',
    aliases: ['protech', 'cadbury', 'dr. pepper', 'dr pepper'],
  },
  { canonical: 'Volt – Microsoft Corporation', aliases: ['volt', 'microsoft corporation', 'premiere queue'] },
  { canonical: 'MCS, Inc.', aliases: ['mcs, inc', 'mcs inc'] },
  { canonical: 'USPI', aliases: ['uspi', 'united surgical'] },
  { canonical: 'Fairfield Community Credit Union', aliases: ['fccu', 'fairfield community', 'fairfield federal'] },
  { canonical: 'MUNA Federal Credit Union', aliases: ['muna'] },
  { canonical: 'NUCOR Steel Corporation', aliases: ['nucor'] },
  { canonical: 'Puckett Machinery', aliases: ['puckett'] },
  { canonical: 'National Breast Cancer Foundation', aliases: ['national breast cancer'] },
];

const NON_EMPLOYERS = new Set(['', 'unknown', 'n/a', 'career summary', 'various regional organizations']);

export const isUnattributed = (employer: string): boolean =>
  NON_EMPLOYERS.has(employer.trim().toLowerCase()) || employer.trim().toLowerCase().startsWith('unknown');

/** Maps any employer spelling onto its canonical form, or null when nothing matches. */
export function canonicalise(employer: string): string | null {
  const value = employer.toLowerCase();
  for (const entry of EMPLOYERS) {
    if (entry.canonical.toLowerCase() === value) return entry.canonical;
    if (entry.aliases.some(alias => value.includes(alias))) return entry.canonical;
  }
  return null;
}

const normalise = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const tokens = (text: string): Set<string> => new Set(normalise(text).split(' ').filter(w => w.length > 3));

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / a.size;
}

/**
 * Recovers the employer for a bullet by finding where it appears in the source documents and
 * walking backwards to the nearest employer heading.
 *
 * Matching is fuzzy because mining lightly reassembled some bullets from fragments, so exact
 * string lookup misses them. A bullet is only attributed when a single employer wins outright —
 * a tie across employers is left unattributed rather than guessed, since a wrong employer on a
 * resume is worse than a missing one.
 */
export function attributeFromDocuments(
  bulletText: string,
  documents: ExtractedDocument[]
): { employer: string; confidence: number } | null {
  const target = tokens(bulletText);
  if (target.size < 4) return null;

  const votes = new Map<string, number>();

  for (const doc of documents) {
    const lines = doc.text.split('\n');
    let currentEmployer: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Headings are short lines naming a company; bullets are long and start with a verb.
      if (trimmed.length < 120) {
        const heading = canonicalise(trimmed);
        if (heading) currentEmployer = heading;
      }
      if (!currentEmployer) continue;

      const score = overlap(target, tokens(trimmed));
      if (score >= 0.75) votes.set(currentEmployer, Math.max(votes.get(currentEmployer) ?? 0, score));
    }
  }

  if (votes.size === 0) return null;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  // Ambiguous when two employers match nearly as well — leave it for a human.
  if (ranked.length > 1 && ranked[1][1] >= ranked[0][1] - 0.05) return null;
  return { employer: ranked[0][0], confidence: ranked[0][1] };
}
