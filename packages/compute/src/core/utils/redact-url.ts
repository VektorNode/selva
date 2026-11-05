const UNREADABLE = '<unreadable URL>';

/**
 * Only a URL with a real host can be cut safely. Anything else could hold a secret at any position:
 * `https://admin:p/ss@host` splits into a bad port and a path.
 */
function parseWithHost(url: string): URL | null {
	try {
		const parsed = new URL(url);
		return parsed.host ? parsed : null;
	} catch {
		return null;
	}
}

/** `url` without credentials, query or fragment, for errors and logs. */
export function redactUrl(url: string): string {
	const parsed = parseWithHost(url);
	if (!parsed) return UNREADABLE;
	parsed.username = '';
	parsed.password = '';
	parsed.search = '';
	parsed.hash = '';
	return parsed.href;
}

/** Scheme and host alone. For a URL that was rejected, whose path can't be trusted either. */
export function redactToOrigin(url: string): string {
	const parsed = parseWithHost(url);
	return parsed ? `${parsed.protocol}//${parsed.host}` : UNREADABLE;
}
