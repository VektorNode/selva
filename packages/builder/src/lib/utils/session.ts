import { goto } from '$app/navigation';
import { page } from '$app/state';
import { getWebSocketState, type WebSocketState } from '$lib/websocket/websocket.svelte';
import type { UISchema, AvailableParameters } from '$lib/types/generated';
import { resolve } from '$app/paths';

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
 * Navigate to a route while preserving the session ID
 */
export function createNavigateTo(sessionId: string) {
  return (path: string) => {
    const url = resolve(`/${path}?session=${sessionId}`);
    goto(url as never);
  };
}

/**
 * Get session ID from URL parameters
 */
export function getSessionIdFromUrl(): string {
  return page.url.searchParams.get('session') || '';
}

/**
 * Initialize WebSocket connection for a session
 */
export async function initializeWebSocketSession(sessionId: string): Promise<SessionInitResult> {
  const wsClient = getWebSocketState();

  if (!sessionId) {
    return {
      sessionId,
      wsClient,
      connected: false,
      error: 'No session ID provided',
    };
  }

  const connected = await wsClient.connect();

  if (!connected) {
    return {
      sessionId,
      wsClient,
      connected: false,
      error:
        'Failed to connect to Grasshopper via WebSocket. Make sure the UI Builder component is enabled and port 8765 is available.',
    };
  }

  return {
    sessionId,
    wsClient,
    connected: true,
    error: null,
  };
}

/**
 * Ensure schema has proper layout defaults
 */
export function ensureSchemaLayoutDefaults(schema: UISchema | null): UISchema | null {
  if (!schema) return null;

  if (!schema.layout) {
    schema.layout = {
      type: 'tabbed',
      gap: 16,
      tabs: [],
    };
  }
  if (!schema.layout.tabs) {
    schema.layout.tabs = [];
  }
  // Ensure instanceSolve has a default value
  if (schema.instanceSolve === undefined) {
    schema.instanceSolve = true;
  }

  return schema;
}

/**
 * Create a new empty schema with defaults
 */
export function createDefaultSchema(): UISchema {
  return {
    id: crypto.randomUUID(),
    name: 'New Schema',
    description: 'Configure your Grasshopper UI',
    created: new Date().toISOString(),
    inputs: [],
    outputs: [],
    layout: {
      type: 'tabbed',
      gap: 16,
      tabs: [],
    },
    enable3dViewer: false,
    instanceSolve: true,
  };
}

/**
 * Get default value for a parameter type
 */
export function getDefaultValue(paramType: string): unknown {
  switch (paramType) {
    case 'Number':
    case 'Integer':
      return 0;
    case 'Boolean':
      return false;
    case 'Text':
      return '';
    default:
      return null;
  }
}

/**
 * Process initial data message and extract schema with defaults
 */
export function processInitialDataSchema(
  message: { schema?: UISchema; availableParams?: AvailableParameters },
  createNewIfMissing: boolean = false
): { schema: UISchema | null; availableParams: AvailableParameters['parameters'] } {
  const availableParams = message.availableParams?.parameters || [];
  let schema = message.schema || null;

  if (!schema && createNewIfMissing) {
    schema = createDefaultSchema();
  } else if (schema) {
    schema = ensureSchemaLayoutDefaults(schema);
  }

  return { schema, availableParams };
}
