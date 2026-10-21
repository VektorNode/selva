// The first exchange on every socket. The plugin's BridgeAccess speaks the other side; both are
// pinned to packages/schemas/fixtures/bridge-handshake.json.

/** The plugin closes a socket with this code when it didn't send the right secret first. */
export const BRIDGE_UNAUTHORIZED_CLOSE_CODE = 4401;

export function authenticateMessage(secret: string): { type: 'authenticate'; secret: string } {
	return { type: 'authenticate', secret };
}

/** The plugin's reply once it has accepted the secret; nothing else may be sent before it. */
export function isAuthenticatedMessage(message: unknown): boolean {
	return (
		typeof message === 'object' &&
		message !== null &&
		(message as { type?: unknown }).type === 'authenticated'
	);
}
