// The plugin opens this page with a per-session secret in the URL fragment (`#s=…`), which the
// browser never sends to a server or puts in a Referer. The socket must present it before the
// plugin talks to it. sessionStorage keeps it for this tab, because in-app navigation drops the
// fragment: the root layout stores it on load, before the user picks a route.

const STORAGE_PREFIX = 'selva:bridge-secret:';

type SecretStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function takeBridgeSecret(
	sessionId: string,
	hash: string,
	storage: SecretStorage | null
): string | null {
	const key = STORAGE_PREFIX + sessionId;
	const fromUrl = new URLSearchParams(hash.replace(/^#/, '')).get('s');

	if (fromUrl) {
		try {
			storage?.setItem(key, fromUrl);
		} catch {
			// Storage blocked: this load still connects, a reload needs the fragment again.
		}
		return fromUrl;
	}

	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

export function isRemembered(
	sessionId: string,
	secret: string,
	storage: SecretStorage | null
): boolean {
	try {
		return storage?.getItem(STORAGE_PREFIX + sessionId) === secret;
	} catch {
		return false;
	}
}

function sessionStorageOrNull(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		// Blocked by the browser's site-data settings.
		return null;
	}
}

/** {@link takeBridgeSecret} for the current page. */
export function bridgeSecretForPage(sessionId: string): string | null {
	return takeBridgeSecret(sessionId, window.location.hash, sessionStorageOrNull());
}

/**
 * Stores the secret from the page URL. True when the URL carried it and storage now holds it,
 * so the fragment can leave the address bar and history.
 */
export function rememberBridgeSecret(sessionId: string): boolean {
	const storage = sessionStorageOrNull();
	const secret = takeBridgeSecret(sessionId, window.location.hash, storage);
	return (
		secret !== null && window.location.hash.length > 0 && isRemembered(sessionId, secret, storage)
	);
}
