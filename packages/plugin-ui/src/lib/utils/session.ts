import { page } from '$app/state';
import { SvelteURLSearchParams } from 'svelte/reactivity';
import { DEFAULT_WEBSOCKET_PORT, WEBSOCKET_PORT_QUERY_PARAM } from '$lib/app.config';

// Pure schema-normalisation helpers live in schema-defaults.ts (node-importable, no
// SvelteKit/WS coupling). Re-exported here so existing `$lib/utils/session` imports keep
// working.
export { ensureSchemaLayoutDefaults, processInitialDataSchema } from './schema-defaults';

// Connection setup moved into the SchemaSource adapter (GrasshopperSource.connect). This
// module now holds only the URL/session helpers — the transport boundary is the source.

/**
 * Get session ID from URL parameters
 */
export function getSessionIdFromUrl(): string {
	return page.url.searchParams.get('session') || '';
}

/**
 * Build URL query params string preserving session and wsPort from the current page URL.
 */
export function buildSessionParams(): string {
	const params = new SvelteURLSearchParams();
	const session = page.url.searchParams.get('session');
	const wsPort = page.url.searchParams.get(WEBSOCKET_PORT_QUERY_PARAM);
	if (session) params.set('session', session);
	if (wsPort) params.set(WEBSOCKET_PORT_QUERY_PARAM, wsPort);
	return params.toString();
}

/**
 * Get WebSocket port from URL parameters
 * Falls back to default port (8765) if not specified
 */
export function getWebSocketPortFromUrl(): number {
	const portParam = page.url.searchParams.get(WEBSOCKET_PORT_QUERY_PARAM);
	if (portParam) {
		const port = parseInt(portParam, 10);
		if (!isNaN(port) && port > 0 && port <= 65535) {
			return port;
		}
	}
	return DEFAULT_WEBSOCKET_PORT;
}
