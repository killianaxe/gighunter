import type { MinedBullet } from '../llm/mine-bullets.js';

export type BulletKind = 'accomplishment' | 'summary' | 'credential';

const CREDENTIAL = /(course ?work|lab exercises|pwk-\d|pen-\d|\bmcts\b|attempt at (the )?exam|exam is pending)/i;

/** Capability claims — true of the person generally, not tied to one job. */
const CAPABILITY_OPENER =
  /^(expert|expertise|extensive experience|proven track record|hands-on experience|in-depth knowledge|strong skills|proficient|experience (with|supporting)|he (is|possesses)|michael (has|possesses|typically|is a))/i;

/** Biographical framing that belongs in a professional summary, never in a work-history bullet. */
const BIOGRAPHICAL = /^(michael( f\.?)?( cumberland)?( ii)?\s+(has|is a|typically|possesses)|he (is|possesses|has))/i;

/**
 * Sorts mined entries into what a resume actually needs.
 *
 * Mining was told to extract accomplishments, but ~25 years of drafts also contain skills
 * inventories, biographical blurbs, and certification coursework. Those are not wrong — they are
 * just a different kind of content, and putting them under a job heading with a date range would
 * misrepresent them. Nothing is discarded; entries are re-filed so tailoring can draw on the
 * summary pool for a professional summary and the accomplishment pool for bullets.
 */
export function classifyBullet(bullet: MinedBullet): BulletKind {
  const text = bullet.text.trim();
  if (CREDENTIAL.test(text)) return 'credential';

  // A concrete metric usually signals a real accomplishment even in third-person phrasing —
  // "deployed over 2500 CrowdStrike sensors" is an achievement, not a capability claim.
  // "27 years of experience" is the exception: a career-length figure, not an outcome.
  const careerLengthOnly = /\b\d{1,2}\+? years of experience\b/i.test(text);
  if (bullet.hasMetrics && !careerLengthOnly && !CAPABILITY_OPENER.test(text)) return 'accomplishment';
  if (bullet.hasMetrics && !careerLengthOnly && BIOGRAPHICAL.test(text) && /\d{3,}/.test(text)) return 'accomplishment';

  if (BIOGRAPHICAL.test(text) || CAPABILITY_OPENER.test(text)) return 'summary';
  return 'accomplishment';
}
