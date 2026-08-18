const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'ltd', 'limited', 'llc', 'llp', 'gmbh', 'ag', 'se',
  'group', 'holdings', 'co', 'corp', 'corporation', 'plc', 'srl', 'sa', 'bv', 'nv',
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strips legal suffixes (Inc, GmbH, Group…) so reposts under name variants collapse together. */
export function normalizeCompany(company: string): string {
  const normalized = company
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalized.split(' ');
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(' ');
}

export function normalizedKey(title: string, company: string): string {
  return `${normalizeTitle(title)}::${normalizeCompany(company)}`;
}
