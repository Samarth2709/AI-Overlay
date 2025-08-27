import pino from 'pino';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.resolve(__dirname, '../../logs');
mkdirSync(logsDir, { recursive: true });

const destination = pino.destination({ dest: path.join(logsDir, 'backend.log'), sync: false });

const logger = pino({ level: process.env.LOG_LEVEL || 'info' }, destination);

export default logger;

