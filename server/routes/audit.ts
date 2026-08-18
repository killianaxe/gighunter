import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', async () => {
    const entries = db.prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50`).all();
    return { entries };
  });
}
