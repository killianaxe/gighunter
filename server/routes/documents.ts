import type { FastifyInstance } from 'fastify';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Your own resume/CV files — drop them straight into this folder. Distinct from the
// tailored .docx Gighunter generates per application (server/pipeline/resume.ts).
const documentsDir = resolve(__dirname, '..', 'data', 'documents');

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.rtf': 'application/rtf',
};

export async function documentsRoutes(app: FastifyInstance) {
  app.get('/api/documents', async () => {
    let entries: string[] = [];
    try {
      entries = readdirSync(documentsDir);
    } catch {
      entries = [];
    }
    const documents = entries
      .filter(name => !name.startsWith('.'))
      .map(name => ({ name, path: resolve(documentsDir, name) }))
      .filter(entry => statSync(entry.path).isFile())
      .map(entry => {
        const stat = statSync(entry.path);
        return { name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return { documents, folder: documentsDir };
  });

  app.get('/api/documents/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const safeName = basename(name);
    const filePath = resolve(documentsDir, safeName);
    if (!filePath.startsWith(documentsDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      return reply.code(404).send({ error: 'document not found' });
    }
    const buffer = readFileSync(filePath);
    const type = CONTENT_TYPES[extname(safeName).toLowerCase()] ?? 'application/octet-stream';
    return reply.header('Content-Type', type).header('Content-Disposition', `inline; filename="${safeName}"`).send(buffer);
  });
}
