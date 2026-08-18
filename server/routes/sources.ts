import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { newId } from '../util/id.js';
import { logAudit } from '../db/audit.js';
import { SOURCE_TYPES } from '../db/types.js';
import type { SourceRow, SourceType } from '../db/types.js';
import { CONNECTOR_CAPABILITIES } from '../connectors/capabilities.js';

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/api/sources', async () => {
    const sources = db.prepare(`SELECT * FROM sources ORDER BY created_at DESC`).all() as SourceRow[];
    return { sources };
  });

  app.get('/api/sources/capabilities', async () => {
    return { capabilities: CONNECTOR_CAPABILITIES };
  });

  app.post('/api/sources', async (request, reply) => {
    const body = (request.body ?? {}) as { type?: string; input?: string; name?: string; cadenceMinutes?: number };
    const input = body.input?.trim();
    if (!input) {
      return reply.code(400).send({ error: 'input is required (a search keyword, or a feed URL for type "rss")' });
    }
    if (!body.type || !SOURCE_TYPES.includes(body.type as SourceType)) {
      return reply.code(400).send({ error: `type is required and must be one of: ${SOURCE_TYPES.join(', ')}` });
    }
    const type = body.type as SourceType;

    const id = newId();
    const name = body.name?.trim() || (type === 'rss' ? safeHost(input) : `${type}: ${input}`);

    db.prepare(
      `
      INSERT INTO sources (id, name, type, query_or_url, cadence_minutes, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `
    ).run(id, name, type, input, body.cadenceMinutes ?? 120);

    logAudit('source', id, 'created', name);
    const source = db.prepare(`SELECT * FROM sources WHERE id = ?`).get(id);
    return reply.code(201).send({ source });
  });

  app.patch('/api/sources/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { enabled?: boolean };
    const existing = db.prepare(`SELECT * FROM sources WHERE id = ?`).get(id);
    if (!existing) return reply.code(404).send({ error: 'source not found' });

    if (typeof body.enabled === 'boolean') {
      db.prepare(`UPDATE sources SET enabled = ? WHERE id = ?`).run(body.enabled ? 1 : 0, id);
      logAudit('source', id, body.enabled ? 'enabled' : 'disabled');
    }

    const source = db.prepare(`SELECT * FROM sources WHERE id = ?`).get(id);
    return { source };
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
