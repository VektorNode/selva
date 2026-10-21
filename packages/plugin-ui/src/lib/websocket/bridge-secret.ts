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

/** {@link takeBridgeSecret} for the current page. */
export function bridgeSecretForPage(sessionId: string): string | null {
	let storage: Storage | null = null;
	try {
		storage = window.sessionStorage;
	} catch {
		// Blocked by the browser's site-data settings.
	}
	return takeBridgeSecret(sessionId, window.location.hash, storage);
}
