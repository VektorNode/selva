// The first exchange on every socket. The plugin's BridgeAccess speaks the other side; both are
// pinned to packages/schemas/fixtures/bridge-handshake.json.

/** The plugin closes a socket with this code when it didn't send the right secret first. */
export const BRIDGE_UNAUTHORIZED_CLOSE_CODE = 4401;

/** The largest file the plugin saves or picks for the Rhino panel (AppConfig.ValueLimits.MaxFileSizeBytes). */
export const MAX_HOST_FILE_BYTES = 157_286_400;

type AuthenticateMessage = { type: 'authenticate'; secret: string; host?: string };

/** `host` is `rhino` from the Rhino panel: only that socket may ask the plugin for a file dialog. */
export function authenticateMessage(secret: string, host?: string): AuthenticateMessage {
	return host ? { type: 'authenticate', secret, host } : { type: 'authenticate', secret };
}

/** The plugin's reply once it has accepted the secret; nothing else may be sent before it. */
export function isAuthenticatedMessage(message: unknown): boolean {
	return (
		typeof message === 'object' &&
		message !== null &&
		(message as { type?: unknown }).type === 'authenticated'
	);
}

/**
 * `author` started from the canvas and may edit the schema; `player` opened the definition from
 * the Selva panel and may only set values. The plugin refuses a player's schema writes; the page
 * only hides them.
 */
export type BridgeRole = 'author' | 'player';

/** The role in an `authenticated` reply. A plugin from before roles sends none: an author. */
export function roleOf(message: unknown): BridgeRole {
	return (message as { role?: unknown }).role === 'player' ? 'player' : 'author';
}
