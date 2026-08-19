import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  convertInchesToTwip,
} from 'docx';
import { countWholeWordMatches } from '../util/text.js';
import type { ApplicationRow, Candidate, JobRow, WorkHistoryBullet } from '../db/types.js';

const US_LETTER = { width: 12240, height: 15840 }; // DXA
const MARGIN = convertInchesToTwip(0.75);
/** Right edge of the text column — where dates and locations align. */
const RIGHT_TAB = US_LETTER.width - MARGIN * 2;
const BULLETS_PER_ROLE = 5;

/**
 * Typography is set explicitly rather than left to the reader's Word.
 *
 * The docx package ships no theme, so a document that names no font renders in whatever default
 * the recipient's Word chooses — Calibri, Aptos, or something else in Google Docs. Line breaks
 * and page count move with it, which for a document whose whole job is a first impression means
 * the candidate cannot know what a recruiter sees. Georgia is a safe choice: present on Windows
 * and macOS, with a large x-height that stays readable at 10.5pt.
 *
 * Everything here stays single-column with no tables, text boxes, headers, or graphics. Resume
 * parsers scramble reading order or silently drop content from all of those, and this pipeline's
 * value depends on an ATS reading the keywords correctly.
 */
const BODY_FONT = 'Georgia';
const BODY_SIZE = 21; // half-points → 10.5pt
const SMALL_SIZE = 18; // 9pt, for contact and meta lines

const sectionHeading = (text: string): Paragraph =>
  new Paragraph({
    spacing: { before: 260, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333', space: 2 } },
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, size: BODY_SIZE, characterSpacing: 30 }),
    ],
  });

const body = (text: string, options: { size?: number; italics?: boolean } = {}): Paragraph =>
  new Paragraph({
    spacing: { after: 60, line: 264 },
    children: [new TextRun({ text, size: options.size ?? BODY_SIZE, italics: options.italics })],
  });

export async function buildResumeDocx(application: ApplicationRow, job: JobRow, candidate: Candidate): Promise<Buffer> {
  const haystack = `${job.title} ${job.description ?? ''}`.toLowerCase();
  const contactLine = [candidate.email, candidate.phone, candidate.linkedin, candidate.homeLocation]
    .filter(Boolean)
    .join('  •  ');

  const experience = candidate.workHistory.flatMap(entry => [
    // Role and dates on one line, employer and location on the next — each pair sharing a right
    // tab stop so the two columns line up without a table.
    new Paragraph({
      spacing: { before: 200 },
      tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
      children: [
        new TextRun({ text: entry.title, bold: true, size: BODY_SIZE }),
        new TextRun({
          text: `\t${entry.startDate} – ${entry.endDate ?? 'Present'}`,
          bold: true,
          size: BODY_SIZE,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80 },
      tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
      children: [
        new TextRun({ text: entry.company, italics: true, size: SMALL_SIZE }),
        new TextRun({ text: `\t${entry.location}`, italics: true, size: SMALL_SIZE }),
      ],
    }),
    ...rankBullets(entry.bullets, haystack, BULLETS_PER_ROLE).map(
      bullet =>
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60, line: 264 },
          children: [new TextRun({ text: bullet.text, size: BODY_SIZE })],
        })
    ),
  ]);

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: BODY_SIZE }, paragraph: { spacing: { line: 264 } } },
      },
    },
    sections: [
      {
        properties: {
          page: { size: US_LETTER, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
        },
        children: [
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: candidate.name.toUpperCase(), bold: true, size: 32, characterSpacing: 40 }),
            ],
          }),
          ...(candidate.headline ? [body(candidate.headline, { italics: true })] : []),
          new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({ text: contactLine, size: SMALL_SIZE })],
          }),

          ...(application.draft_summary
            ? [sectionHeading('Professional Summary'), body(application.draft_summary)]
            : []),

          ...(candidate.skills.length > 0
            ? [sectionHeading('Core Skills'), body(candidate.skills.join('  •  '))]
            : []),

          sectionHeading('Professional Experience'),
          ...experience,

          ...(candidate.additionalExperience.length > 0
            ? [
                sectionHeading('Additional Experience'),
                ...candidate.additionalExperience.map(
                  line =>
                    new Paragraph({
                      bullet: { level: 0 },
                      spacing: { after: 60, line: 264 },
                      children: [new TextRun({ text: line, size: BODY_SIZE })],
                    })
                ),
              ]
            : []),

          ...(candidate.certifications.length > 0
            ? [sectionHeading('Certifications'), body(candidate.certifications.join('  •  '))]
            : []),

          ...(candidate.education.length > 0
            ? [
                sectionHeading('Education'),
                ...candidate.education.map(entry =>
                  body(`${entry.degree} — ${entry.school} (${entry.years})`)
                ),
              ]
            : []),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/** Same ranking approach as draft.ts's buildDraft, scoped to one work-history entry's own bullets. */
function rankBullets(bullets: WorkHistoryBullet[], haystack: string, limit: number): WorkHistoryBullet[] {
  const ranked = bullets
    .map(bullet => ({ bullet, hits: countWholeWordMatches(haystack, bullet.keywords) }))
    .filter(entry => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map(entry => entry.bullet);

  return (ranked.length > 0 ? ranked : bullets).slice(0, limit);
}

export function resumeFilename(candidate: Candidate, job: JobRow): string {
  const safe = (value: string, maxLen = 40) =>
    value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, maxLen);
  // job.id suffix guarantees uniqueness — company/title alone collide whenever a candidate
  // has multiple applications to the same company (common), silently overwriting resumes.
  const shortId = job.id.replace(/-/g, '').slice(0, 8);
  return `${safe(candidate.name)}_${safe(job.company)}_${safe(job.title)}_${shortId}.docx`;
}
