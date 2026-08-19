import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getClient, MODEL, estimateCostUsd } from './client.js';
import type { Candidate, JobRow } from '../db/types.js';

const TailoredBullet = z.object({
  sourceText: z.string().describe('The original bullet text, copied exactly, so the rewrite can be diffed against it.'),
  tailoredText: z.string().describe('The rewritten bullet, leading with the vocabulary this job description uses.'),
  changed: z.boolean().describe('False when the original already fits and was returned unmodified.'),
});

export const TailoredApplicationSchema = z.object({
  headline: z.string().describe('One line positioning the candidate for this specific role. No template phrasing.'),
  summary: z.string().describe('Two or three sentences of professional summary aimed at this posting.'),
  bullets: z.array(TailoredBullet).describe('The 4-6 most relevant bullets, strongest first, rewritten for this posting.'),
  leadSkills: z.array(z.string()).describe('Candidate skills to list first, ordered by relevance to this posting.'),
  leadCertifications: z.array(z.string()).describe('Candidate certifications ordered by relevance to this posting.'),
  keywordGaps: z
    .array(z.string())
    .describe('Terms the posting emphasises that appear nowhere in the candidate material — an honest gap list, not filled in.'),
  coveredButUnstated: z
    .array(z.string())
    .describe('Terms the posting wants that the candidate demonstrably has but never names literally (e.g. holds VCP-Network Virtualization but never writes "NSX").'),
  fitAssessment: z.string().describe('One honest sentence on fit, including reasons not to apply if they exist.'),
});

export type TailoredApplication = z.infer<typeof TailoredApplicationSchema>;

export const TAILORING_RULES = `You tailor a real candidate's resume material to a specific job posting. Your output is sent to real employers on their behalf, so honesty is a hard constraint, not a preference.

ABSOLUTE RULES:
- NEVER invent experience, skills, employers, dates, tools, or metrics. You may only rephrase what the candidate has actually written.
- Preserve every number, percentage, dollar figure, and proper noun EXACTLY. "2,500+ sensors" stays "2,500+ sensors".
- Never claim experience with a technology the candidate has not evidenced. If the posting wants Kubernetes and the candidate has never mentioned it, that belongs in keywordGaps — not in a bullet.
- You may reorder, reframe, and re-lead a bullet so it opens with the terminology this posting uses, as long as every fact survives unchanged.

REWRITING BULLETS:
Lead with what this posting cares about. If the posting is about disaster recovery and the bullet buries "15-minute RPO" at the end, restructure so the DR outcome comes first. Keep bullets to one or two lines. If a bullet already leads correctly, return it unchanged with changed=false.

coveredButUnstated IS THE HIGH-VALUE FIELD:
Find cases where the candidate genuinely has what the posting wants but never uses the posting's word for it — a certification that implies a product ("VCP-Network Virtualization" implies NSX), an older product name, an implied skill. These are silent ATS failures. Be rigorous: only list something the candidate's material actually evidences.

fitAssessment MUST BE HONEST. If the candidate is a weak fit, say so plainly. A tool that tells someone not to waste an application is more valuable than one that flatters.`;

export interface TailoringOutcome extends TailoredApplication {
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * The candidate's full material as the model sees it. Exported because the MCP tailoring route
 * hands the identical brief to an agent — the two paths must not drift.
 */
export function candidateBrief(candidate: Candidate): string {
  const bullets = candidate.resumeBullets.map(b => `- ${b.text}`).join('\n');
  const history = candidate.workHistory
    .map(
      entry =>
        `### ${entry.title} — ${entry.company} (${entry.startDate} to ${entry.endDate ?? 'Present'})\n` +
        entry.bullets.map(b => `- ${b.text}`).join('\n')
    )
    .join('\n\n');

  return [
    `## Skills\n${candidate.skills.join(', ')}`,
    `## Certifications\n${candidate.certifications.join('\n')}`,
    `## Headline accomplishments\n${bullets}`,
    `## Work history\n${history}`,
    candidate.additionalExperience.length ? `## Earlier roles\n${candidate.additionalExperience.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function tailorApplication(job: JobRow, candidate: Candidate): Promise<TailoringOutcome> {
  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: TAILORING_RULES,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content:
          `# The posting\n**${job.title}** at ${job.company}` +
          `${job.location ? ` — ${job.location}` : ''}\n\n${job.description ?? '(no description provided)'}\n\n` +
          `# My material\n${candidateBrief(candidate)}`,
      },
    ],
    output_config: { format: zodOutputFormat(TailoredApplicationSchema) },
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
