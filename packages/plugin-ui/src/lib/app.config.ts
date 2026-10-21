export const CURRENT_SCHEMA_VERSION = '1.0.0';

// WebSocket configuration
export const DEFAULT_WEBSOCKET_PORT = 8765;
export const WEBSOCKET_PORT_QUERY_PARAM = 'wsPort';

// The plugin closes a socket with this code when it didn't send the right secret first.
export const BRIDGE_UNAUTHORIZED_CLOSE_CODE = 4401;

// Reconnection settings
export const WEBSOCKET_RECONNECT_INTERVAL = 3000; // in milliseconds
export const WEBSOCKET_MAX_RECONNECT_ATTEMPTS = 10;
