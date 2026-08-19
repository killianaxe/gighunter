import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getClient, MODEL, estimateCostUsd } from './client.js';
import type { ExtractedDocument } from '../documents/extract-text.js';

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
}

/**
 * One call with every document in context, so the model can deduplicate globally — the same
 * achievement reworded across a dozen resume drafts can only be collapsed with a full view.
 */
export async function mineBullets(documents: ExtractedDocument[]): Promise<MiningOutcome> {
  const corpus = documents
    .map(doc => `<document name="${doc.name}">\n${doc.text}\n</document>`)
    .join('\n\n');

  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: `Here are ${documents.length} versions of my resume/CV, written over ~25 years. Extract the complete deduplicated library of my accomplishment bullets.\n\n${corpus}`,
      },
    ],
    output_config: { format: zodOutputFormat(MiningResult) },
  });

  if (!response.parsed_output) {
    throw new Error(`Model returned no parseable output (stop_reason: ${response.stop_reason})`);
  }

  return {
    ...response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: estimateCostUsd(response.usage),
    },
  };
}
