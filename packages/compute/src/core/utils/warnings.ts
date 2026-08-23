import { getLogger } from './logger';

/** Functions that already warned — the exposure risk doesn't change per call, so once is enough. */
const warnedFunctions = new Set<string>();

/**
 * True only in a GENUINE browser/worker context — the case where an API key in
 * the config is actually exposed to end users. `typeof window !== 'undefined'`
 * alone is not enough: jsdom test environments define `window` too, and every
 * unsuppressed vitest/jest run would warn noisily (issue 110).
 *
 * Detection: `window` must exist, AND we must not be in Node (jsdom runs in
 * Node, so `process.versions.node` is defined there but never in a real
 * browser), AND the user agent must not carry jsdom's marker (belt-and-braces
 * for exotic setups that hide `process`). Genuine browsers pass all three.
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

/** @internal Reset the once-per-function dedupe — for tests only. */
export function resetClientSideWarnings(): void {
	warnedFunctions.clear();
}
