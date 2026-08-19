import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getClient, MINING_MODEL, estimateCostUsd } from './client.js';
import type { ExtractedDocument } from '../documents/extract-text.js';
import { dedupeDocuments, renderDedupedCorpus, type DedupedBlock, type DedupeResult } from '../documents/dedupe.js';

/** Families mirror SKILL_FAMILIES in pipeline/match.ts so mined bullets slot into domain scoring. */
export const BULLET_FAMILIES = [
  'virtualization',
  'identity',
  'endpoint',
  'cloud',
  'security',
  'automation',
  'disasterRecovery',
  'linux',
  'ai',
  'leadership',
  'other',
] as const;

const MinedBullet = z.object({
  text: z.string().describe('The accomplishment, as one resume bullet. Verbatim from the source where possible.'),
  employer: z.string().describe('Employer this accomplishment belongs to, exactly as written in the resume.'),
  role: z.string().describe('Job title held at that employer, exactly as written.'),
  family: z.enum(BULLET_FAMILIES).describe('Primary technical domain of this accomplishment.'),
  keywords: z.array(z.string()).describe('Lowercase terms a job description would use to match this bullet.'),
  hasMetrics: z.boolean().describe('True if the bullet contains a specific number, percentage, or dollar figure.'),
});

const MiningResult = z.object({
  bullets: z.array(MinedBullet),
  employersSeen: z.array(z.string()).describe('Every distinct employer found across the documents.'),
  notes: z.array(z.string()).describe('Contradictions between resume versions worth a human review (e.g. conflicting dates).'),
});

export type MinedBullet = z.infer<typeof MinedBullet>;
export type MiningResult = z.infer<typeof MiningResult>;

const SYSTEM = `You extract accomplishment bullets from a candidate's own resume versions to build a master library for tailoring future applications.

ABSOLUTE RULES — the output is used to represent a real person to real employers:
- NEVER invent, embellish, or extrapolate. Every bullet must be traceable to the source text.
- Preserve every number, percentage, dollar figure, date, product name, and proper noun EXACTLY as written. Do not round "2,500+ sensors" to "thousands", do not convert "98%" to "nearly all".
- If a detail is ambiguous across versions, keep the wording of the most complete version and record the discrepancy in notes.
- Do not merge two different achievements into one bullet.
- Do not add adjectives the candidate did not write ("innovative", "world-class") unless present in the source.

DEDUPLICATION:
These documents are many drafts of ONE person's resume spanning years, so the same achievement recurs with different wording. Emit each distinct achievement ONCE, choosing the most specific and complete phrasing available. Two bullets describing the same project at the same employer are duplicates even if worded differently. Two bullets about genuinely different work are not.

KEYWORDS:
For each bullet supply lowercase keywords a job description would plausibly contain if it wanted this experience. Include product names ("vsphere", "entra id"), the general skill ("disaster recovery"), and common synonyms/older names ("azure ad" alongside "entra id"). These drive keyword matching, so favour terms that appear in real postings.

COVERAGE:
Be thorough — capture every distinct accomplishment across all documents, including older roles. A large library is the point; the tool selects from it per job.`;

export interface MiningOutcome extends MiningResult {
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  dedupe: DedupeResult['stats'];
}

/**
 * Thinking tokens are billed as output AND count against max_tokens, so effort is the setting
 * that actually governs whether a batch fits. At xhigh the model reasoned its way through most
 * of a 16k budget before emitting JSON and truncated. Extraction here is rule-following against
 * an explicit schema, not open judgment, so low effort is both correct and what fits.
 */
const BLOCKS_PER_BATCH = Number(process.env.MINING_BLOCKS_PER_BATCH) || 60;
const MAX_TOKENS_PER_BATCH = Number(process.env.MINING_MAX_TOKENS) || 32000;

export interface BatchOutcome {
  bullets: MinedBullet[];
  employersSeen: string[];
  notes: string[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Mines one batch of deduplicated blocks.
 *
 * Streamed rather than a plain request: the SDK caps non-streaming calls at 10 minutes, and
 * Opus at xhigh effort runs past that on batches this size.
 */
export async function mineBatch(
  blocks: DedupedBlock[],
  context: { batch: number; batches: number },
  onProgress?: (chars: number) => void
): Promise<BatchOutcome> {
  const corpus = renderDedupedCorpus(blocks);

  const stream = getClient().messages.stream({
    model: MINING_MODEL,
    max_tokens: MAX_TOKENS_PER_BATCH,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: zodOutputFormat(MiningResult) },
    messages: [
      {
        role: 'user',
        content:
          `This is part ${context.batch} of ${context.batches} of my resume material, spanning ~25 years and ` +
          `20+ drafts. Exact and near-exact repeats have already been collapsed mechanically; each block is ` +
          `annotated with how many drafts contained it and the newest such draft. A block in many drafts is ` +
          `long-standing material; one in few may be recent or abandoned.\n\n` +
          `Extract every distinct accomplishment bullet from this part. Ignore section headers, contact ` +
          `details, and skills lists — only accomplishments.\n\n${corpus}`,
      },
    ],
  });

  if (onProgress) stream.on('text', text => onProgress(text.length));
  const response = await stream.finalMessage();

  if (!response.parsed_output) {
    // The response was billed whether or not it parsed. Surface what was actually spent and
    // how the budget was divided, so the next attempt is sized from data rather than a guess.
    const text = response.content.find(block => block.type === 'text');
    throw Object.assign(
      new Error(
        `batch ${context.batch}: no parseable output (stop_reason: ${response.stop_reason}) — ` +
          `used ${response.usage.output_tokens} of ${MAX_TOKENS_PER_BATCH} output tokens`
      ),
      { partialText: text && 'text' in text ? text.text : '', usage: response.usage }
    );
  }

  return {
    ...response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: estimateCostUsd(response.usage, MINING_MODEL),
    },
  };
}

/** Splits deduplicated blocks into batches sized for a single response. */
export function planBatches(documents: ExtractedDocument[]): { batches: DedupedBlock[][]; stats: DedupeResult['stats'] } {
  const deduped = dedupeDocuments(documents);
  const batches: DedupedBlock[][] = [];
  for (let i = 0; i < deduped.blocks.length; i += BLOCKS_PER_BATCH) {
    batches.push(deduped.blocks.slice(i, i + BLOCKS_PER_BATCH));
  }
  return { batches, stats: deduped.stats };
}

/**
 * Merges batch results into one library, dropping any bullet a later batch repeats verbatim.
 * The mechanical dedup already collapsed near-duplicates, so this only guards the seams.
 */
export function mergeBatches(results: BatchOutcome[]): MiningResult & { usage: BatchOutcome['usage'] } {
  const seen = new Set<string>();
  const bullets: MinedBullet[] = [];
  for (const result of results) {
    for (const bullet of result.bullets) {
      const key = bullet.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      bullets.push(bullet);
    }
  }
  return {
    bullets,
    employersSeen: [...new Set(results.flatMap(r => r.employersSeen))],
    notes: results.flatMap(r => r.notes),
    usage: {
      inputTokens: results.reduce((sum, r) => sum + r.usage.inputTokens, 0),
      outputTokens: results.reduce((sum, r) => sum + r.usage.outputTokens, 0),
      costUsd: results.reduce((sum, r) => sum + r.usage.costUsd, 0),
    },
  };
}
