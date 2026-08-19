import type { ExtractedDocument } from './extract-text.js';

export interface DedupedBlock {
  text: string;
  /** Documents this block (or a near-identical variant) appeared in, newest first. */
  sources: string[];
  variants: number;
}

export interface DedupeResult {
  blocks: DedupedBlock[];
  stats: { documents: number; blocksIn: number; blocksOut: number; exactCollapsed: number; nearCollapsed: number };
}

/** Jaccard overlap above this counts as the same accomplishment reworded. */
const NEAR_DUPLICATE_THRESHOLD = 0.82;
/** Short lines (headers, "Skills", dates) are too generic for similarity to mean anything. */
const MIN_WORDS_FOR_FUZZY = 6;

const comparisonKey = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const wordSet = (key: string): Set<string> => new Set(key.split(' ').filter(w => w.length > 2));

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Collapses 20+ drafts of one resume into the distinct content underneath them.
 *
 * Two passes: an exact-normalized hash removes the copy-paste bulk cheaply, then a fuzzy pass
 * catches the same achievement reworded between versions. The fuzzy pass only compares blocks
 * that share an uncommon word, which keeps it near-linear instead of quadratic across thousands
 * of blocks.
 *
 * When variants collide the LONGEST is kept, matching what mine-bullets.ts asks the model to do
 * ("keep the wording of the most complete version") — a later draft that trimmed a metric should
 * not silently erase it from the library.
 */
export function dedupeDocuments(documents: ExtractedDocument[]): DedupeResult {
  const exact = new Map<string, DedupedBlock>();
  let blocksIn = 0;
  let exactCollapsed = 0;

  for (const doc of documents) {
    for (const raw of doc.text.split(/\n\s*\n|\n(?=[-•*]\s)/)) {
      const text = raw.trim();
      if (text.length < 25) continue;
      blocksIn += 1;

      const key = comparisonKey(text);
      const existing = exact.get(key);
      if (!existing) {
        exact.set(key, { text, sources: [doc.name], variants: 1 });
        continue;
      }
      exactCollapsed += 1;
      existing.variants += 1;
      if (!existing.sources.includes(doc.name)) existing.sources.push(doc.name);
      if (text.length > existing.text.length) existing.text = text;
    }
  }

  // Fuzzy pass, bucketed by rarest word so we never do a full n² sweep.
  const frequency = new Map<string, number>();
  const entries = [...exact.values()].map(block => {
    const words = wordSet(comparisonKey(block.text));
    for (const word of words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    return { block, words, merged: false };
  });

  const buckets = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (entry.words.size < MIN_WORDS_FOR_FUZZY) continue;
    let rarest = '';
    let rarestCount = Infinity;
    for (const word of entry.words) {
      const count = frequency.get(word) ?? 0;
      if (count < rarestCount) [rarest, rarestCount] = [word, count];
    }
    const bucket = buckets.get(rarest) ?? [];
    bucket.push(entry);
    buckets.set(rarest, bucket);
  }

  let nearCollapsed = 0;
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      const keep = bucket[i];
      if (keep.merged) continue;
      for (let j = i + 1; j < bucket.length; j += 1) {
        const other = bucket[j];
        if (other.merged) continue;
        if (jaccard(keep.words, other.words) < NEAR_DUPLICATE_THRESHOLD) continue;

        other.merged = true;
        nearCollapsed += 1;
        keep.block.variants += other.block.variants;
        for (const source of other.block.sources) {
          if (!keep.block.sources.includes(source)) keep.block.sources.push(source);
        }
        if (other.block.text.length > keep.block.text.length) keep.block.text = other.block.text;
      }
    }
  }

  const blocks = entries.filter(entry => !entry.merged).map(entry => entry.block);
  return {
    blocks,
    stats: { documents: documents.length, blocksIn, blocksOut: blocks.length, exactCollapsed, nearCollapsed },
  };
}

/** Renders the deduped library for the mining prompt, carrying provenance for the notes field. */
export function renderDedupedCorpus(blocks: DedupedBlock[]): string {
  return blocks
    .map(block => {
      const seen = block.variants > 1 ? ` (appears in ${block.variants} drafts, newest: ${block.sources[0]})` : ` (${block.sources[0]})`;
      return `${block.text}${seen}`;
    })
    .join('\n\n');
}

const significantWords = (text: string): string[] =>
  text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 3);

export const fingerprint = (text: string): Set<string> => new Set(significantWords(text));

/**
 * Whether `text` restates something already present.
 *
 * Two independent signals, because one threshold cannot serve both cases. Plain overlap catches
 * rewording and tense changes. The prefix rule catches the harder case: one achievement written
 * twice with different tails — "…across three branch locations while maintaining FFIEC, NCUA and
 * GLBA compliance" versus "…across three branch locations (Pine Bluff, Watson Chapel, White
 * Hall)". Those share only 0.70 of their words, yet an identical eight-word opening and the same
 * metric make them unmistakably the same accomplishment. Lowering the overlap threshold far
 * enough to catch that would start merging genuinely distinct work.
 */
export function restatesExisting(text: string, existing: Set<string>[], rawExisting: string[]): boolean {
  const mine = fingerprint(text);
  if (mine.size < 5) return false;

  for (const theirs of existing) {
    if (theirs.size < 5) continue;
    let shared = 0;
    for (const word of mine) if (theirs.has(word)) shared += 1;
    if (shared / Math.min(mine.size, theirs.size) >= 0.75) return true;
  }

  const myWords = significantWords(text);
  const myPrefix = myWords.slice(0, 8).join(' ');
  const myNumbers = new Set(text.match(/\d[\d,.]*/g) ?? []);
  for (const other of rawExisting) {
    const otherWords = significantWords(other);
    if (otherWords.slice(0, 8).join(' ') !== myPrefix) continue;
    const otherNumbers = new Set(other.match(/\d[\d,.]*/g) ?? []);
    // Same opening AND a shared figure — or same opening with no figures on either side.
    if (myNumbers.size === 0 && otherNumbers.size === 0) return true;
    for (const number of myNumbers) if (otherNumbers.has(number)) return true;
  }
  return false;
}
