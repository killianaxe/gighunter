import { Document, Packer, Paragraph, TextRun, convertInchesToTwip } from 'docx';
import { containsWholeWord, countWholeWordMatches } from '../util/text.js';
import { BODY_FONT, BODY_SIZE, NAME_SIZE, SMALL_SIZE } from './resume.js';
import type { CoverLetter, TailoredApplication } from '../llm/tailor.js';
import type { ApplicationRow, Candidate, JobRow } from '../db/types.js';

const US_LETTER = { width: 12240, height: 15840 }; // DXA

/**
 * A full inch, where the resume uses three quarters.
 *
 * The resume is fighting for space and its margin is a compromise. A cover letter is four
 * paragraphs on one page with room to spare, so it takes the conventional business-letter inch —
 * a letter crammed to a three-quarter-inch margin looks like it was squeezed to fit.
 */
const MARGIN = convertInchesToTwip(1);

/** Where the letter came from — see buildCoverLetterDocx. */
export type CoverLetterSource = 'tailored' | 'template';

const para = (text: string, options: { size?: number; after?: number; bold?: boolean } = {}): Paragraph =>
  new Paragraph({
    spacing: { after: options.after ?? 200, line: 276 },
    children: [new TextRun({ text, size: options.size ?? BODY_SIZE, bold: options.bold })],
  });

/**
 * Builds the greeting from the recipient name rather than accepting a generated one.
 *
 * "To Whom It May Concern" and a hallucinated hiring-manager name are the two ways a greeting
 * goes wrong, and both are eliminated by never letting a model write this line. Defensive
 * normalisation strips a "Dear " prefix or trailing punctuation in case the name field is
 * over-filled anyway.
 */
export function salutation(recipient: string | null | undefined): string {
  const name = (recipient ?? '')
    .trim()
    .replace(/^dear\s+/i, '')
    .replace(/[,:\s]+$/, '')
    .trim();
  return name ? `Dear ${name},` : 'Dear Hiring Manager,';
}

/** "August 20, 2026" — the date the letter is generated, which is the date it is sent. */
function letterDate(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Ends a fragment with exactly one period, so composed sentences never double-punctuate. */
function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, '');
  return trimmed ? `${trimmed}.` : '';
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Turns a resume headline into a sentence.
 *
 * A headline is designed to sit under a name as a fragment — "Senior Systems Engineer — Cloud
 * Security & Identity | Virtualization | Cyber Security" — and dropping it into prose verbatim
 * produces a sentence with no verb and two kinds of pipe. Splitting on the separators recovers a
 * role and its focus areas, which do compose into a sentence.
 */
function headlineSentence(headline: string): string {
  const [role, ...focus] = headline
    .split(/\s*[—–|,]\s*/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!role) return '';
  return focus.length > 0
    ? sentence(`I am a ${role} working across ${list(focus)}`)
    : sentence(`I am a ${role}`);
}

/**
 * A resume bullet can run sixty words and still be a good bullet — a reader scanning a bulleted
 * list tolerates density that the same sentence in a paragraph does not. Letters get the short ones.
 */
const MAX_LETTER_BULLET_WORDS = 45;
const LETTER_EVIDENCE_COUNT = 2;

/** True for a "location" that is a work arrangement rather than somewhere mail could be sent. */
function isRemoteDesignation(location: string): boolean {
  return /\b(remote|anywhere|worldwide|distributed|hybrid)\b/i.test(location);
}

/**
 * A letter assembled from the candidate's own material with no model call.
 *
 * This exists for the same reason buildDraft does: the notifier drafts every match it announces
 * and the scheduler delivers every strong one, both without an LLM in the loop. Without a
 * deterministic letter, every auto-delivered application would arrive with a resume and nothing
 * else. Every sentence here is either the candidate's own text or a statement of fact about the
 * application itself, so nothing is fabricated — but it is a starting point, not a finished
 * letter, and callers surface `source: 'template'` so that is never in doubt.
 */
export function templateCoverLetter(job: JobRow, candidate: Candidate): CoverLetter {
  const haystack = `${job.title} ${job.description ?? ''}`.toLowerCase();
  const matchedSkills = candidate.skills.filter(skill => containsWholeWord(haystack, skill));
  const evidence = candidate.resumeBullets
    .map(bullet => ({ bullet, hits: countWholeWordMatches(haystack, bullet.keywords) }))
    .filter(entry => entry.hits > 0 && entry.bullet.text.split(/\s+/).length <= MAX_LETTER_BULLET_WORDS)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, LETTER_EVIDENCE_COUNT)
    .map(entry => sentence(entry.bullet.text));

  const contact = [candidate.email, candidate.phone].filter(Boolean).join(' or ');

  return {
    recipient: null,
    opening: [
      sentence(`I am applying for the ${job.title} position at ${job.company}`),
      candidate.headline ? headlineSentence(candidate.headline) : '',
      matchedSkills.length > 0
        ? sentence(`My background covers ${list(matchedSkills.slice(0, 3))}, which this posting asks for directly`)
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    fitParagraph:
      evidence.length > 0
        ? `Work from my recent roles that bears on this one: ${evidence.join(' ')}`
        : sentence(
            `My experience is set out in the attached resume, and the roles listed there cover the responsibilities in this posting`
          ),
    interestParagraph: sentence(
      `This role reads as a continuation of the work I have been doing rather than a change of direction, which is why I am applying rather than filtering it out`
    ),
    closingParagraph: [
      sentence(`I would welcome the chance to talk through how this experience maps to what your team needs`),
      contact ? sentence(`I can be reached at ${contact}`) : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

/**
 * The stored tailoring's letter if one exists, otherwise the deterministic fallback.
 *
 * Reads defensively: tailoring_json rows written before cover letters existed have no
 * coverLetter key, and a stored letter missing a paragraph is worse than no stored letter.
 */
export function resolveCoverLetter(
  application: ApplicationRow,
  job: JobRow,
  candidate: Candidate
): { letter: CoverLetter; source: CoverLetterSource } {
  if (application.tailoring_json) {
    try {
      const tailoring = JSON.parse(application.tailoring_json) as Partial<TailoredApplication>;
      const stored = tailoring.coverLetter;
      if (stored?.opening && stored.fitParagraph && stored.interestParagraph && stored.closingParagraph) {
        return { letter: stored, source: 'tailored' };
      }
    } catch {
      // Corrupt JSON falls through to the template rather than failing the download.
    }
  }
  return { letter: templateCoverLetter(job, candidate), source: 'template' };
}

/**
 * Renders a one-page business letter in block format.
 *
 * Same face and sizes as the resume (imported, not copied) so the pair reads as one set. Block
 * format means no first-line indents and a blank line between paragraphs — the convention every
 * recruiter expects, and the only layout that survives being pasted into an application form's
 * plain-text box.
 */
export async function buildCoverLetterDocx(
  application: ApplicationRow,
  job: JobRow,
  candidate: Candidate
): Promise<{ buffer: Buffer; source: CoverLetterSource }> {
  const { letter, source } = resolveCoverLetter(application, job, candidate);
  const contactLine = [candidate.email, candidate.phone, candidate.linkedin, candidate.homeLocation]
    .filter(Boolean)
    .join('  •  ');

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: BODY_SIZE }, paragraph: { spacing: { line: 276 } } },
      },
    },
    sections: [
      {
        properties: {
          page: { size: US_LETTER, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
        },
        children: [
          // Letterhead, identical to the resume's so the two documents are visibly a pair.
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: candidate.name.toUpperCase(), bold: true, size: NAME_SIZE, characterSpacing: 40 }),
            ],
          }),
          new Paragraph({
            spacing: { after: 320 },
            children: [new TextRun({ text: contactLine, size: SMALL_SIZE })],
          }),

          para(letterDate(), { after: 320 }),

          // Recipient block. Only what is actually known — an invented street address would be
          // the same kind of fabrication the tailoring rules forbid everywhere else. A job
          // location is omitted when it describes an arrangement ("Remote (United States)")
          // rather than a place: in the address position that reads as the company's address,
          // which it is not.
          ...(job.location && !isRemoteDesignation(job.location)
            ? [para(job.company, { after: 0 }), para(job.location, { after: 320 })]
            : [para(job.company, { after: 320 })]),

          para(salutation(letter.recipient), { after: 240 }),

          para(letter.opening),
          para(letter.fitParagraph),
          para(letter.interestParagraph),
          para(letter.closingParagraph, { after: 320 }),

          para('Sincerely,', { after: 480 }), // room for a signature
          para(candidate.name, { after: 0 }),
        ],
      },
    ],
  });

  return { buffer: await Packer.toBuffer(doc), source };
}

export function coverLetterFilename(candidate: Candidate, job: JobRow): string {
  const safe = (value: string, maxLen = 40) =>
    value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, maxLen);
  // Mirrors resumeFilename, including the job.id suffix that keeps repeat applications to the
  // same company from overwriting each other.
  const shortId = job.id.replace(/-/g, '').slice(0, 8);
  return `${safe(candidate.name)}_${safe(job.company)}_${safe(job.title)}_${shortId}_CoverLetter.docx`;
}
