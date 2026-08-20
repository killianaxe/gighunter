import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getClient, MODEL, estimateCostUsd } from './client.js';
import type { Candidate, JobRow } from '../db/types.js';

const TailoredBullet = z.object({
  sourceText: z.string().describe('The original bullet text, copied exactly, so the rewrite can be diffed against it.'),
  tailoredText: z.string().describe('The rewritten bullet, leading with the vocabulary this job description uses.'),
  changed: z.boolean().describe('False when the original already fits and was returned unmodified.'),
});

/**
 * The cover letter's body, paragraph by paragraph — deliberately not one free-text blob.
 *
 * Splitting it means the renderer, not the model, owns the parts that are rules rather than
 * prose: the greeting, the sign-off, and the letterhead. A model asked for a whole letter will
 * eventually produce "To Whom It May Concern" or drop the sign-off; a model asked only for
 * `recipient` plus four paragraphs cannot. Structure enforces what a prompt can only request.
 */
export const CoverLetterSchema = z.object({
  recipient: z
    .string()
    .nullable()
    .describe(
      'The hiring manager\'s name with honorific, exactly as the posting gives it (e.g. "Ms. Rivera"). Null unless the posting actually names the person — a guessed name is far worse than no name.'
    ),
  opening: z
    .string()
    .describe(
      'Introduction: who the candidate is and which role they are applying for, named exactly as the posting titles it. Lead with a concrete accomplishment or a specific reason for applying — never "I am writing to apply for".'
    ),
  fitParagraph: z
    .string()
    .describe(
      'Why the candidate fits: two or three specific achievements from their material with every metric intact, mapped onto what this posting asks for. Explain what those achievements mean for this employer rather than restating the resume in prose.'
    ),
  interestParagraph: z
    .string()
    .describe(
      'Why this role at this company, grounded in something the posting actually says. If the posting gives nothing concrete to point at, tie the interest to the work itself — never invent enthusiasm about a company you know nothing about.'
    ),
  closingParagraph: z
    .string()
    .describe('Brief close: restate the fit in one sentence and invite an interview. No new claims.'),
});

export type CoverLetter = z.infer<typeof CoverLetterSchema>;

/**
 * A cover letter should be about one page. Enforced in code rather than by prompt because
 * length is the failure mode reviewers actually notice, and it is trivially measurable.
 * The bounds are deliberately loose — they catch a stub and a three-pager, not a long paragraph.
 */
export const COVER_LETTER_WORD_RANGE = { min: 120, max: 500 } as const;

export function coverLetterWordCount(letter: CoverLetter): number {
  return [letter.opening, letter.fitParagraph, letter.interestParagraph, letter.closingParagraph]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Returns a human-readable complaint, or null when the letter is a sane length. */
export function checkCoverLetterLength(letter: CoverLetter): string | null {
  const words = coverLetterWordCount(letter);
  if (words < COVER_LETTER_WORD_RANGE.min) {
    return `cover letter is only ${words} words; a real letter runs ${COVER_LETTER_WORD_RANGE.min}-${COVER_LETTER_WORD_RANGE.max}`;
  }
  if (words > COVER_LETTER_WORD_RANGE.max) {
    return `cover letter is ${words} words; it must fit one page (at most ${COVER_LETTER_WORD_RANGE.max})`;
  }
  return null;
}

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
  coverLetter: CoverLetterSchema.describe('The cover letter body for this posting. Same honesty rules as the bullets.'),
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

fitAssessment MUST BE HONEST. If the candidate is a weak fit, say so plainly. A tool that tells someone not to waste an application is more valuable than one that flatters.

THE COVER LETTER:
Write it for this one posting. A letter that would work unchanged for another company has failed — name the role exactly as the posting titles it, and point at something the posting actually says.

- Every honesty rule above applies without exception. The letter is prose, which makes fabrication easier and no more acceptable.
- Do not restate the resume in paragraph form. The bullets say WHAT the candidate did; the letter says what that means for THIS employer. If a sentence would be redundant next to the resume, cut it.
- Use concrete achievements with their numbers intact. "Cut recovery time to a 15-minute RPO" beats "strong disaster recovery background".
- Vary sentence openings — a letter where most sentences begin with "I" reads as a list.
- 250 to 400 words across the four paragraphs. One page, no exceptions.
- Leave out anything a resume would not carry: age, marital status, health, politics, salary history.
- recipient: only a name the posting itself provides. Null otherwise. The renderer writes the greeting; you never do.
- interestParagraph is where letters go generic. If the posting says nothing about the company beyond boilerplate, write about the substance of the work instead of praising a company you have no information about. Vague flattery is worse than none.`;

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
