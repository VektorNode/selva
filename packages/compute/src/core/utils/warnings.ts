import { getLogger } from './logger';

/** Functions that already warned — the exposure risk doesn't change per call, so once is enough. */
const warnedFunctions = new Set<string>();

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
	if (suppress) {
		return;
	}

	if (isRealBrowser() && !warnedFunctions.has(functionName)) {
		warnedFunctions.add(functionName);
		getLogger().warn(
			`Warning: ${functionName} is running on the client side. For better performance and security, consider running this on the server side.`
		);
	}
}

/** Reset the once-per-function dedupe. For tests. */
export function resetClientSideWarnings(): void {
	warnedFunctions.clear();
}
