import './env.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocuments } from './documents/extract-text.js';
import { mineBatch, mergeBatches, planBatches, type BatchOutcome } from './llm/mine-bullets.js';
import { llmConfigured, MINING_MODEL } from './llm/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const documentsDir = resolve(__dirname, 'data', 'documents');
const checkpointDir = resolve(__dirname, 'data', 'mining-batches');
const outputPath = resolve(__dirname, 'data', 'bullet-library.json');

if (!llmConfigured()) {
  console.error('ANTHROPIC_API_KEY is not set — add it to server/.env.');
  process.exit(1);
}

const paths = readdirSync(documentsDir)
  .filter(name => !name.startsWith('.') && !name.includes('Zone.Identifier'))
  .map(name => resolve(documentsDir, name))
  .filter(path => statSync(path).isFile())
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

const { documents, skipped } = await extractDocuments(paths);
for (const entry of skipped) console.log(`  skipped ${entry.name} — ${entry.reason}`);

const { batches, stats } = planBatches(documents);
mkdirSync(checkpointDir, { recursive: true });

console.log(`${documents.length} documents | ${stats.blocksIn} blocks -> ${stats.blocksOut} deduped`);
console.log(`${batches.length} batches on ${MINING_MODEL}\n`);

const results: BatchOutcome[] = [];
let spent = 0;

// A canary run (`npm run mine -- 1`) proves the batch shape before committing to all of them.
const limit = Number(process.argv[2]) || batches.length;

for (const [index, blocks] of batches.entries()) {
  if (index >= limit) {
    console.log(`\nstopping after ${limit} batch(es) — rerun without a limit to continue (cached batches are not re-billed)`);
    break;
  }
  const number = index + 1;
  const checkpoint = resolve(checkpointDir, `batch-${String(number).padStart(2, '0')}.json`);

  // Resume support: a batch already on disk is never re-billed. Two failed runs made this
  // the most important property of the script.
  if (existsSync(checkpoint)) {
    const cached = JSON.parse(readFileSync(checkpoint, 'utf-8')) as BatchOutcome;
    results.push(cached);
    console.log(`batch ${number}/${batches.length}  cached (${cached.bullets.length} bullets)`);
    continue;
  }

  const started = Date.now();
  let lastReport = started;
  process.stdout.write(`batch ${number}/${batches.length}  mining ${blocks.length} blocks...`);

  let outcome: BatchOutcome;
  try {
    outcome = await mineBatch(blocks, { batch: number, batches: batches.length }, () => {
      if (Date.now() - lastReport > 15_000) {
        lastReport = Date.now();
        process.stdout.write('.');
      }
    });
  } catch (err) {
    // A run can die mid-way for reasons that have nothing to do with the data — exhausted
    // credits, a rate limit, a dropped connection. Completed batches are already paid for, so
    // write the library from what finished rather than discarding it. Rerunning resumes here.
    console.log(`\n\nbatch ${number} failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`writing a partial library from the ${results.length} batch(es) that completed.`);
    break;
  }

  writeFileSync(checkpoint, JSON.stringify(outcome, null, 2));
  results.push(outcome);
  spent += outcome.usage.costUsd;
  console.log(
    ` ${outcome.bullets.length} bullets, ${((Date.now() - started) / 1000).toFixed(0)}s, ` +
      `$${outcome.usage.costUsd.toFixed(3)} (running total $${spent.toFixed(2)})`
  );
}

if (results.length === 0) {
  console.error('no batches completed — nothing to write.');
  process.exit(1);
}

const complete = results.length === batches.length;
const library = mergeBatches(results);
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      minedAt: new Date().toISOString(),
      model: MINING_MODEL,
      complete,
      batchesCompleted: `${results.length}/${batches.length}`,
      dedupe: stats,
      sourceDocuments: documents.map(d => d.name),
      ...library,
    },
    null,
    2
  )
);

console.log(`\nbullets: ${library.bullets.length} | employers: ${library.employersSeen.length} | notes: ${library.notes.length}`);
console.log(`tokens: ${library.usage.inputTokens.toLocaleString()} in / ${library.usage.outputTokens.toLocaleString()} out`);
console.log(`COST THIS RUN: $${spent.toFixed(3)}  (library total $${library.usage.costUsd.toFixed(3)})`);
console.log(`saved -> ${outputPath}${complete ? '' : `  (PARTIAL: ${results.length}/${batches.length} batches)`}`);
