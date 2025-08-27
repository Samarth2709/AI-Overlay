import 'dotenv/config';
import Fastify from 'fastify';
import logger from './lib/logger.js';
import cors from '@fastify/cors';
import chatRoutes from './routes/chat.js';
import conversationsRoutes from './routes/conversations.js';
import modelsRoutes from './routes/models.js';

const app = Fastify({ logger });

await app.register(cors, { origin: true });
await app.register(conversationsRoutes);
await app.register(chatRoutes);
await app.register(modelsRoutes);

const port = Number(process.env.PORT || 7071);
const host = process.env.HOST || '0.0.0.0';

app.listen({ port, host })
  .then(() => {
    app.log.info(`[backend] listening on http://${host}:${port}`);
  })
  .catch((err) => {
    app.log.error(err, 'Failed to start backend');
    process.exit(1);
  });
