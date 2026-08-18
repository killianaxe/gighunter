import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { ApplicationRow, Candidate, JobRow, WorkHistoryBullet } from '../db/types.js';

const US_LETTER = { width: 12240, height: 15840 }; // DXA
const BULLETS_PER_ROLE = 5;

/**
 * Full resume: contact header, tailored summary, then real work history (employer/title/dates)
 * with each role's bullets ranked by JD keyword overlap the same way draft.ts ranks the flat
 * pool — only the top N per role are shown, so older/less-relevant roles surface fewer bullets
 * without disappearing from the timeline. Older roles beyond the curated work history appear as
 * condensed one-liners (additionalExperience), matching how the source resume itself presents them.
 */
export async function buildResumeDocx(application: ApplicationRow, job: JobRow, candidate: Candidate): Promise<Buffer> {
  const haystack = `${job.title} ${job.description ?? ''}`.toLowerCase();

  const contactLine = [candidate.email, candidate.phone, candidate.linkedin, candidate.homeLocation]
    .filter(Boolean)
    .join('  •  ');

  const experienceSection = candidate.workHistory.flatMap(entry => {
    const dateRange = `${entry.startDate} – ${entry.endDate ?? 'Present'}`;
    return [
      new Paragraph({
        spacing: { before: 200 },
        children: [new TextRun({ text: `${entry.title} — ${entry.company}`, bold: true })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `${entry.location}  |  ${dateRange}`, italics: true, size: 20 })],
      }),
      ...rankBullets(entry.bullets, haystack, BULLETS_PER_ROLE).map(
        bullet => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: bullet.text })] })
      ),
    ];
  });

  const doc = new Document({
    sections: [
      {
        properties: { page: { size: US_LETTER } },
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: candidate.name, bold: true })],
          }),
          ...(contactLine ? [new Paragraph({ children: [new TextRun({ text: contactLine, size: 20 })] })] : []),
          new Paragraph({
            children: [new TextRun({ text: application.draft_headline ?? '', italics: true })],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [new TextRun({ text: `Tailored for: ${job.title} at ${job.company}`, bold: true })],
          }),
          new Paragraph({ text: '' }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: 'Professional Summary' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: application.draft_summary ?? '' })],
          }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200 },
            children: [new TextRun({ text: 'Core Skills' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: candidate.skills.join(' • ') })],
          }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200 },
            children: [new TextRun({ text: 'Professional Experience' })],
          }),
          ...experienceSection,

          ...(candidate.additionalExperience.length > 0
            ? [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  spacing: { before: 200 },
                  children: [new TextRun({ text: 'Additional Experience' })],
                }),
                ...candidate.additionalExperience.map(
                  line => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: line })] })
                ),
              ]
            : []),

          ...(candidate.certifications.length > 0
            ? [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  spacing: { before: 200 },
                  children: [new TextRun({ text: 'Certifications' })],
                }),
                new Paragraph({ children: [new TextRun({ text: candidate.certifications.join(' • ') })] }),
              ]
            : []),

          ...(candidate.education.length > 0
            ? [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  spacing: { before: 200 },
                  children: [new TextRun({ text: 'Education' })],
                }),
                ...candidate.education.map(
                  entry =>
                    new Paragraph({
                      children: [new TextRun({ text: `${entry.degree} — ${entry.school} (${entry.years})` })],
                    })
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
    .map(bullet => ({ bullet, hits: bullet.keywords.filter(k => haystack.includes(k.toLowerCase())).length }))
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
