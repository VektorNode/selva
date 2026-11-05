import { getLogger } from './logger';

const warned = new Set<string>();

/** Log `message` the first time `key` is seen: what it reports doesn't change per call. */
export function warnOnce(key: string, message: string): void {
	if (warned.has(key)) return;
	warned.add(key);
	getLogger().warn(message);
}

/**
 * True only in a real browser, where an API key in the config is exposed to users. jsdom defines
 * `window` too, so Node is ruled out by `process.versions.node`, and by jsdom's user-agent marker
 * for setups that hide `process`.
 */
function isRealBrowser(): boolean {
	if (typeof window === 'undefined') return false;

	const proc = (globalThis as { process?: { versions?: { node?: unknown } } }).process;
	if (proc?.versions?.node != null) return false;

	const nav = (globalThis as { navigator?: { userAgent?: unknown } }).navigator;
	const userAgent = typeof nav?.userAgent === 'string' ? nav.userAgent : '';
	if (/jsdom/i.test(userAgent)) return false;

	return true;
}

export function warnIfClientSide(functionName: string, suppress?: boolean): void {
	if (suppress || !isRealBrowser()) return;
	warnOnce(
		`client-side:${functionName}`,
		`Warning: ${functionName} is running on the client side. For better performance and security, consider running this on the server side.`
	);
}

/** Forget what already warned. For tests. */
export function resetWarnings(): void {
	warned.clear();
}
