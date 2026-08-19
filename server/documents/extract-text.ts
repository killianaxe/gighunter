import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import mammoth from 'mammoth';

export interface ExtractedDocument {
  name: string;
  text: string;
}

export interface ExtractionResult {
  documents: ExtractedDocument[];
  skipped: { name: string; reason: string }[];
}

/** Formats we can read today. .doc (binary) and .pdf need separate tooling; .xlsx isn't a resume. */
const TEXT_EXTENSIONS = new Set(['.txt', '.md']);

async function extractOne(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path });
    return value;
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return readFileSync(path, 'utf-8');
  }
  throw new Error(`unsupported format ${ext}`);
}

/**
 * Reads every provided document to plain text, skipping rather than failing on formats we
 * can't parse — a couple of unreadable files shouldn't sink a batch of thirty.
 */
export async function extractDocuments(paths: string[]): Promise<ExtractionResult> {
  const documents: ExtractedDocument[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const path of paths) {
    const name = basename(path);
    try {
      const text = (await extractOne(path)).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (text.length < 200) {
        skipped.push({ name, reason: 'too little text to be a resume' });
        continue;
      }
      documents.push({ name, text });
    } catch (err) {
      skipped.push({ name, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { documents, skipped };
}
