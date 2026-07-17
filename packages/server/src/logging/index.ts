// Structured logging — pino-backed ILogger (optional `pino` peer, console
// fallback) plus request-id resolution for correlation.

export { createLogger, ConsoleLogger, type CreateLoggerOptions } from './PinoLogger.js';
export {
	resolveRequestId,
	sanitizeRequestId,
	renderThrown,
	REQUEST_ID_HEADER
} from './requestId.js';
