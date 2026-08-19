import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocuments } from './documents/extract-text.js';
import { attributeFromDocuments, canonicalise, isUnattributed } from './documents/attribute.js';
import { classifyBullet } from './documents/classify.js';
import { mergeBatches, type BatchOutcome, type MinedBullet } from './llm/mine-bullets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkpointDir = resolve(__dirname, 'data', 'mining-batches');
const libraryPath = resolve(__dirname, 'data', 'bullet-library.json');
const documentsDir = resolve(__dirname, 'data', 'documents');

/**
 * Rebuilds the library from the batch checkpoints every time rather than editing the previous
 * output in place. The checkpoints are the only paid artefact and never change, so sourcing from
 * them makes this script idempotent — rerunning it can refine the repair but can never compound
 * an earlier pass or destroy content moved aside by one.
 */
const batchFiles = readdirSync(checkpointDir).filter(name => name.endsWith('.json')).sort();
const results = batchFiles.map(name => JSON.parse(readFileSync(resolve(checkpointDir, name), 'utf-8')) as BatchOutcome);
const merged = mergeBatches(results);

const paths = readdirSync(documentsDir)
  .filter(name => !name.startsWith('.') && !name.includes('Zone.Identifier'))
  .map(name => resolve(documentsDir, name))
  .filter(path => statSync(path).isFile());
const { documents } = await extractDocuments(paths);

const summaries: MinedBullet[] = [];
const credentials: MinedBullet[] = [];
const accomplishments: MinedBullet[] = [];
for (const bullet of merged.bullets) {
  const kind = classifyBullet(bullet);
  if (kind === 'summary') summaries.push(bullet);
  else if (kind === 'credential') credentials.push(bullet);
  else accomplishments.push(bullet);
}

let canonicalised = 0;
let recovered = 0;
let unresolved = 0;
for (const bullet of accomplishments) {
  if (isUnattributed(bullet.employer)) {
    const found = attributeFromDocuments(bullet.text, documents);
    if (found) {
      bullet.employer = found.employer;
      recovered += 1;
    } else {
      bullet.employer = 'UNRESOLVED';
      unresolved += 1;
    }
    continue;
  }
  const canonical = canonicalise(bullet.employer);
  if (canonical && canonical !== bullet.employer) {
    bullet.employer = canonical;
    canonicalised += 1;
  }
}

// Cross-batch near-duplicates: mergeBatches drops only verbatim repeats, so one achievement
// worded differently in two batches survives twice. Keep the attributed, metric-bearing variant.
const rank = (bullet: MinedBullet): number =>
  (bullet.employer !== 'UNRESOLVED' ? 2 : 0) + (bullet.hasMetrics ? 1 : 0) + bullet.text.length / 10000;
const words = (text: string) =>
  new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));

const kept: MinedBullet[] = [];
let fuzzyDropped = 0;
for (const bullet of [...accomplishments].sort((a, b) => rank(b) - rank(a))) {
  const mine = words(bullet.text);
  // Short bullets share too few distinctive words for overlap to be meaningful.
  const duplicate =
    mine.size >= 5 &&
    kept.some(existing => {
      const theirs = words(existing.text);
      if (theirs.size < 5) return false;
      let shared = 0;
      for (const word of mine) if (theirs.has(word)) shared += 1;
      return shared / Math.min(mine.size, theirs.size) >= 0.8;
    });
  if (duplicate) fuzzyDropped += 1;
  else kept.push(bullet);
}

writeFileSync(
  libraryPath,
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      batches: `${batchFiles.length}/14`,
      sourceDocuments: documents.length,
      bullets: kept,
      summaryStatements: summaries,
      credentialNotes: credentials,
      employersSeen: [...new Set(kept.map(b => b.employer))].filter(e => e !== 'UNRESOLVED').sort(),
      notes: merged.notes,
      usage: merged.usage,
    },
    null,
    2
  )
);

console.log(`mined bullets from ${batchFiles.length} checkpoints : ${merged.bullets.length}`);
console.log(`  -> accomplishments      : ${accomplishments.length}`);
console.log(`  -> summary statements   : ${summaries.length}`);
console.log(`  -> credential notes     : ${credentials.length}`);
console.log('');
console.log(`employers recovered from documents : ${recovered}`);
console.log(`employer names canonicalised       : ${canonicalised}`);
console.log(`cross-batch duplicates dropped     : ${fuzzyDropped}`);
console.log(`left UNRESOLVED for a human        : ${unresolved}`);
console.log('');
console.log(`FINAL: ${kept.length} accomplishment bullets across ${new Set(kept.map(b => b.employer)).size} employers`);
