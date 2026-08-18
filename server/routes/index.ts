import type { FastifyInstance } from 'fastify';
import { overviewRoutes } from './overview.js';
import { matchesRoutes } from './matches.js';
import { scanRoutes } from './scan.js';
import { sourcesRoutes } from './sources.js';
import { applicationsRoutes } from './applications.js';
import { auditRoutes } from './audit.js';
import { documentsRoutes } from './documents.js';
import { profileRoutes } from './profile.js';
import { pipelineRoutes } from './pipeline.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(overviewRoutes);
  await app.register(matchesRoutes);
  await app.register(scanRoutes);
  await app.register(sourcesRoutes);
  await app.register(applicationsRoutes);
  await app.register(auditRoutes);
  await app.register(documentsRoutes);
  await app.register(profileRoutes);
  await app.register(pipelineRoutes);
}
