import { db } from './index.js';
import { newId } from '../util/id.js';

export function logAudit(entityType: string, entityId: string, action: string, detail?: string): void {
  db.prepare(
    `INSERT INTO audit_log (id, entity_type, entity_id, action, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(newId(), entityType, entityId, action, detail ?? null);
}
