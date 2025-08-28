/**
 * Logger Configuration
 * 
 * Configures the Pino logger for the backend application.
 * Logs are written to a file with rotation and structured JSON format.
 */

import pino from 'pino';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current file directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const logsDir = path.resolve(__dirname, '../../logs');
mkdirSync(logsDir, { recursive: true });

// Configure async file destination for better performance
const destination = pino.destination({ 
  dest: path.join(logsDir, 'backend.log'), 
  sync: false // Use async writes for better performance
});

// Create logger instance with configurable log level
const logger = pino(
  { 
    level: process.env.LOG_LEVEL || 'info' 
  }, 
  destination
);

export default logger;

