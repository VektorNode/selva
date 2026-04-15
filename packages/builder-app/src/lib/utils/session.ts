import { page } from '$app/state';
import { getWebSocketState, type WebSocketState } from '$lib/websocket/websocket.svelte';
import type { UISchema, DiscoveredParameters } from 'selva-shared';
import { DEFAULT_WEBSOCKET_PORT, WEBSOCKET_PORT_QUERY_PARAM } from '$lib/app.config';

/**
 * Session initialization result
 */
export interface SessionInitResult {
	sessionId: string;
	wsClient: WebSocketState;
	connected: boolean;
	error: string | null;
}

/**
 * Common session state interface
 */
export interface SessionState {
	sessionId: string;
	loading: boolean;
	error: string;
	wsConnected: boolean;
}

/**
 * Get session ID from URL parameters
 */
export function getSessionIdFromUrl(): string {
	return page.url.searchParams.get('session') || '';
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

/**
 * Initialize WebSocket connection for a session
 */
export async function initializeWebSocketSession(sessionId: string): Promise<SessionInitResult> {
	// Get WebSocket port from URL or use default
	const wsPort = getWebSocketPortFromUrl();
	const wsClient = getWebSocketState(wsPort);

	if (!sessionId) {
		return {
			sessionId,
			wsClient,
			connected: false,
			error: 'No session ID provided'
		};
	}

	const connected = await wsClient.connect();

	if (!connected) {
		return {
			sessionId,
			wsClient,
			connected: false,
			error: `Failed to connect to Grasshopper via WebSocket on port ${wsPort}. Make sure the UI Builder component is enabled.`
		};
	}

	return {
		sessionId,
		wsClient,
		connected: true,
		error: null
	};
}

/**
 * Ensure schema has proper layout defaults
 */
function ensureSchemaLayoutDefaults(schema: UISchema | null): UISchema | null {
	if (!schema) return null;

	if (!schema.layout) {
		schema.layout = {
			type: 'tabbed',
			gap: 16,
			tabs: []
		};
	}

	if (schema.layout.type === 'tabbed' && !schema.layout.tabs) {
		schema.layout.tabs = [];
	}
	if (schema.instanceSolve === undefined) {
		schema.instanceSolve = true;
	}

	return schema;
}

/**
 * Get default value for a parameter type
 */
export function getDefaultValue(paramType: string): unknown {
	switch (paramType) {
		case 'number':
		case 'integer':
			return 0;
		case 'boolean':
			return false;
		case 'text':
			return '';
		default:
			return null;
	}
}

/**
 * Process initial data message and extract schema with defaults
 * Note: Default schema creation is now handled by the C# UIBuilderComponent,
 * which includes document metadata (projectFileName, documentId)
 */
export function processInitialDataSchema(message: {
	schema?: UISchema;
	availableParams?: DiscoveredParameters;
}): {
	schema: UISchema | null;
	availableInputs: DiscoveredParameters['inputs'];
	availableOutputs: DiscoveredParameters['outputs'];
} {
	const availableInputs = message.availableParams?.inputs || [];
	const availableOutputs = message.availableParams?.outputs || [];
	let schema = message.schema || null;

	if (schema) {
		schema = ensureSchemaLayoutDefaults(schema);
	}

	return { schema, availableInputs, availableOutputs };
}
