/**
 * Whole-word matching for skills, keywords, and exclusion terms.
 *
 * Substring matching is the obvious implementation and it is wrong here. Job descriptions are
 * long prose, so a bare `haystack.includes(term)` fires on any word that happens to contain the
 * term: "storage" contains "rag", "international" contains "intern", "paragraph" contains "rag".
 * Across 895 postings that produced 47 spurious AI-domain matches against 16 real ones — the
 * false positives outnumbered the true ones three to one, and scoring silently drifted.
 *
 * Boundaries are applied only where the term's own edge is a word character. `\b` between two
 * non-word characters never matches, so anchoring a term like "c++" or ".net" on both sides
 * would make it unmatchable. Skills are user-editable from Agent settings, so that case is
 * reachable, not theoretical.
 */
export function containsWholeWord(haystack: string, term: string): boolean {
  const trimmed = term.trim().toLowerCase();
  if (!trimmed) return false;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leading = /^\w/.test(trimmed) ? '\\b' : '';
  const trailing = /\w$/.test(trimmed) ? '\\b' : '';

  return new RegExp(`${leading}${escaped}${trailing}`, 'i').test(haystack);
}

/** Counts how many of `terms` appear as whole words in `haystack`. */
export function countWholeWordMatches(haystack: string, terms: string[]): number {
  return terms.filter(term => containsWholeWord(haystack, term)).length;
}
