import type { BridgeRole } from '#lib/websocket/bridge-handshake.js';
import { getWebSocketState } from '#lib/websocket/websocket.svelte.js';
import { getWebSocketPortFromUrl, isPlayerUrl } from './session';

/**
 * The URL picks the first paint; once the plugin has acknowledged the socket, its role wins. Edit
 * in Grasshopper reloads the page on an author URL, so the two only disagree for a moment.
 */
export function currentRole(): BridgeRole {
	return getWebSocketState(getWebSocketPortFromUrl()).role ?? (isPlayerUrl() ? 'player' : 'author');
}
