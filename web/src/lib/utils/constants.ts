/**
 * Shared constants across the application
 */

// Session ID format
export const SESSION_ID_LENGTH = 8;

// WebSocket configuration
export const DEFAULT_WEBSOCKET_PORT = 8765;
export const WEBSOCKET_URL = `ws://localhost:${DEFAULT_WEBSOCKET_PORT}`;

// Reconnection settings
export const WEBSOCKET_RECONNECT_INTERVAL = 3000;
export const WEBSOCKET_MAX_RECONNECT_ATTEMPTS = 10;

// JSON formatting
export const JSON_INDENT_SPACES = 2;

// API endpoints
export const API_BASE_URL = '/api';

// UI styling constants
export const OUTPUT_COLOR =
	'bg-violet-200 hover:bg-violet-200 dark:bg-violet-700 dark:hover:bg-violet-700 dark:saturate-20';
export const INPUT_COLOR =
	'bg-stone-200/60 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700';

/**
 * Generate a session ID (8-character UUID)
 */
export function generateSessionId(): string {
	return crypto.randomUUID().substring(0, SESSION_ID_LENGTH);
}
