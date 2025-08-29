/**
 * AI Assistant Backend Server
 * 
 * Main entry point for the AI Assistant backend API server.
 * Provides chat functionality with multiple AI providers (OpenAI, Gemini, Grok).
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

// Resolve .env from src/ first, then fallback to project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envCandidates = [
  process.env.DOTENV_PATH,
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '..', '.env')
].filter(Boolean);
for (const p of envCandidates) {
  try {
    if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
  } catch (_) {}
}
import Fastify from 'fastify';
import logger from './lib/logger.js';
import cors from '@fastify/cors';
import { registerAllTools } from './tools/index.js';

// Route imports
import chatRoutes from './routes/chat.js';
import conversationsRoutes from './routes/conversations.js';
import modelsRoutes from './routes/models.js';

// Initialize Fastify server with logger
const app = Fastify({ 
  logger, 
  disableRequestLogging: true // Disable default request logging to use custom logging
});

// Register plugins and routes
await app.register(cors, { origin: true }); // Allow all origins for development
// Register tools once on boot
try { registerAllTools(); app.log.info({ event: 'tools_registered' }, 'Tools registered'); } catch (e) { app.log.error({ event: 'tools_register_error', error: e.message }, 'Failed to register tools'); }
await app.register(conversationsRoutes);
await app.register(chatRoutes);
await app.register(modelsRoutes);

// Server configuration
const port = Number(process.env.PORT || 7071);
const host = process.env.HOST || '0.0.0.0';

// Start server
app.listen({ port, host })
  .then(() => {
    app.log.info(`[backend] listening on http://${host}:${port}`);
  })
  .catch((err) => {
    app.log.error(err, 'Failed to start backend');
    process.exit(1);
  });
