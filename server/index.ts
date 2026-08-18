import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/index.js';
import { registerRoutes } from './routes/index.js';
import { startScheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Only the public/ folder is served — never the project root, which holds server/.env and source.
const publicRoot = resolve(__dirname, '..', 'public');

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/],
});
await app.register(cookie);
await app.register(fastifyStatic, {
  root: publicRoot,
  index: 'index.html',
});

await registerRoutes(app);

const jobCount = (db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number }).n;
app.log.info(`Database ready with ${jobCount} jobs on file.`);

startScheduler();

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: '127.0.0.1' }, err => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
