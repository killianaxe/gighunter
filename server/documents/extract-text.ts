import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import mammoth from 'mammoth';

const execFileAsync = promisify(execFile);

export interface ExtractedDocument {
  name: string;
  text: string;
}

export interface ExtractionResult {
  documents: ExtractedDocument[];
  skipped: { name: string; reason: string }[];
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md']);
/** Legacy .doc and .pdf have no usable JS parser here, but LibreOffice reads both. */
const CONVERTIBLE_EXTENSIONS = new Set(['.doc', '.pdf', '.rtf', '.odt']);

/**
 * Converts a format mammoth can't read into .docx via headless LibreOffice, returning the
 * extracted text. PDFs need the Draw import filter named explicitly — without it LibreOffice
 * refuses the file rather than routing it through Writer.
 */
async function convertViaLibreOffice(path: string): Promise<string> {
  const workDir = mkdtempSync(join(tmpdir(), 'orbit-extract-'));
  try {
    const args = ['--headless', '--convert-to', 'docx', '--outdir', workDir];
    if (extname(path).toLowerCase() === '.pdf') args.splice(1, 0, '--infilter=writer_pdf_import');
    // -env:UserInstallation isolates the profile so a running desktop LibreOffice
    // doesn't cause the headless call to silently no-op.
    args.unshift(`-env:UserInstallation=file://${workDir}/profile`);
    await execFileAsync('libreoffice', [...args, path], { timeout: 180_000 });

    const converted = join(workDir, `${basename(path, extname(path))}.docx`);
    const { value } = await mammoth.extractRawText({ path: converted });
    return value;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Resume exports written on Windows are often cp1252, not UTF-8. Decoding those as UTF-8
 * turns every curly apostrophe into U+FFFD, so "the world's largest" reaches the model — and
 * potentially an employer — as "the world?s largest". Strict UTF-8 first, cp1252 on failure.
 */
function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

async function extractOne(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path });
    return value;
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return decodeText(readFileSync(path));
  }
  if (CONVERTIBLE_EXTENSIONS.has(ext)) {
    return convertViaLibreOffice(path);
  }
  throw new Error(`unsupported format ${ext}`);
}

/**
 * PDF import preserves visual line breaks, so a wrapped sentence arrives as several lines.
 * Rejoining them matters because downstream deduplication compares whole paragraphs — the
 * same bullet wrapped at a different width would otherwise look like new content.
 */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/([^\n.:;•\-])\n(?=[a-z(])/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
      const text = normalize(await extractOne(path));
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
