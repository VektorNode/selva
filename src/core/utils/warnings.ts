import { getLogger } from './logger';

/** Functions that already warned — the exposure risk doesn't change per call, so once is enough. */
const warnedFunctions = new Set<string>();

export function warnIfClientSide(functionName: string, suppress?: boolean): void {
	if (suppress) {
		return;
	}

	if (typeof window !== 'undefined' && !warnedFunctions.has(functionName)) {
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
