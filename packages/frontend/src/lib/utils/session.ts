import { page } from '$app/state';
import { getWebSocketState, type WebSocketState } from '$lib/websocket/websocket.svelte';
import type { UISchema, AvailableParameters } from '$lib/types/generated';

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
    viewerOptions: {
      enableLocal: false,
      enableRemote: false,
      backgroundColor: '#ffffff',
    },
    instanceSolve: true,
  };
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
 */
export function processInitialDataSchema(
  message: {
    schema?: UISchema;
    availableParams?: AvailableParameters;
  },
  createNewIfMissing: boolean = false
): {
  schema: UISchema | null;
  availableInputs: AvailableParameters['inputs'];
  availableOutputs: AvailableParameters['outputs'];
} {
  const availableInputs = message.availableParams?.inputs || [];
  const availableOutputs = message.availableParams?.outputs || [];
  let schema = message.schema || null;

  if (!schema && createNewIfMissing) {
    schema = createDefaultSchema();
  } else if (schema) {
    schema = ensureSchemaLayoutDefaults(schema);
  }

  return { schema, availableInputs, availableOutputs };
}
