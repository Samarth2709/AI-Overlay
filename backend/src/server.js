/**
 * AI Assistant Backend Server
 * 
 * Main entry point for the AI Assistant backend API server.
 * Provides chat functionality with multiple AI providers (OpenAI, Gemini, Grok).
 */

import 'dotenv/config';
import Fastify from 'fastify';
import logger from './lib/logger.js';
import cors from '@fastify/cors';

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
