export const CURRENT_SCHEMA_VERSION = '1.0.0';

// WebSocket configuration
export const DEFAULT_WEBSOCKET_PORT = 8765;
export const WEBSOCKET_PORT_QUERY_PARAM = 'wsPort';

// `host=rhino` when the plugin opened this page in its Rhino panel rather than a browser tab.
export const HOST_QUERY_PARAM = 'host';
export const RHINO_PANEL_HOST = 'rhino';
// `mode=player` when the Selva panel opened the definition rather than the canvas. It only picks
// the first paint; the role the plugin acknowledges the socket with is what counts.
export const MODE_QUERY_PARAM = 'mode';
export const PLAYER_MODE = 'player';
// The Rhino host intercepts navigations to `selva-panel://<command>` and runs the command.
export const RHINO_TOGGLE_WINDOW_URL = 'selva-panel://toggle-window';
// Rhino's Open dialog; the pick replaces the current player definition.
export const RHINO_OPEN_DEFINITION_URL = 'selva-panel://open';
// The host sets `window.__selvaHostContainer` and dispatches this event, detail 'panel' or
// 'window', whenever the UI moves between the docked panel and its own window.
export const RHINO_HOST_CONTAINER_EVENT = 'selva-host-container';

// Reconnection settings
export const WEBSOCKET_RECONNECT_INTERVAL = 3000; // in milliseconds
export const WEBSOCKET_MAX_RECONNECT_ATTEMPTS = 10;
