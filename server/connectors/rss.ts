import type { NormalizedListing } from '../db/types.js';

const USER_AGENT = 'Orbit/0.1 (+local job search assistant)';

/** User-supplied RSS/Atom feeds only — career pages and job boards that publish one. No HTML scraping. */
export async function fetchRss(feedUrl: string): Promise<NormalizedListing[]> {
  const res = await fetch(feedUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });
  if (!res.ok) {
    throw new Error(`RSS request failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  return parseFeed(xml, feedUrl);
}

export function parseFeed(xml: string, feedUrl: string): NormalizedListing[] {
  const items = extractBlocks(xml, 'item');
  const entries = items.length > 0 ? items : extractBlocks(xml, 'entry');
  const fallbackCompany = safeHost(feedUrl);

  return entries
    .map(block => {
      const rawTitle = decodeXml(extractTag(block, 'title')) ?? 'Untitled role';
      const link = extractLink(block);
      const description = decodeXml(
        stripHtml(extractTag(block, 'description') ?? extractTag(block, 'summary') ?? extractTag(block, 'content'))
      );
      const pubDate = extractTag(block, 'pubDate') ?? extractTag(block, 'published') ?? extractTag(block, 'updated');
      const { title, company } = splitTitleCompany(rawTitle, fallbackCompany);

      const listing: NormalizedListing = {
        externalId: link,
        title,
        company,
        location: null,
        description,
        url: link ?? feedUrl,
        salaryMin: null,
        salaryMax: null,
        postedAt: pubDate ? safeIsoDate(pubDate) : null,
      };
      return listing;
    })
    .filter(listing => Boolean(listing.url));
}

function extractBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return null;
  return match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function extractLink(block: string): string | null {
  const hrefMatch = block.match(/<link\b[^>]*\bhref="([^"]+)"[^>]*\/?>/i);
  if (hrefMatch) return hrefMatch[1];
  const simple = extractTag(block, 'link');
  return simple ? simple.trim() : null;
}

function stripHtml(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function splitTitleCompany(title: string, fallbackCompany: string): { title: string; company: string } {
  for (const sep of [' at ', ' – ', ' - ', ' | ']) {
    const idx = title.indexOf(sep);
    if (idx > -1) {
      return { title: title.slice(0, idx).trim(), company: title.slice(idx + sep.length).trim() };
    }
  }
  return { title, company: fallbackCompany };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'RSS source';
  }
}

function safeIsoDate(raw: string): string | null {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
