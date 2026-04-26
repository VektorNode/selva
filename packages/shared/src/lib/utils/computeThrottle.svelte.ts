import { APP_DEFAULTS } from '../constants';

/**
 * Compute throttle utility for managing async compute requests.
 *
 * - Only one request in-flight at a time
 * - Latest values always win (no queue)
 * - AbortController support to cancel stale requests
 * - Configurable timeout with automatic abort
 */
interface ComputeThrottleOptions {
	timeout?: number;
}

/**
 * Creates a throttled compute handler that ensures only one request is in-flight at a time.
 * When a new request arrives while one is running, the new values are queued and processed
 * immediately after the current request finishes (or aborts).
 */
export function createComputeThrottle<T>(
	computeFn: (values: T, signal: AbortSignal) => Promise<void>,
	options: ComputeThrottleOptions = {}
): {
	trigger: (values: T) => void;
	readonly isComputing: boolean;
	readonly hasPending: boolean;
	cancel: () => void;
} {
	const { timeout = APP_DEFAULTS.TIMEOUTS.COMPUTE_TIMEOUT } = options;

	let isComputing = $state(false);
	let pendingValues = $state<T | null>(null);
	let currentAbortController: AbortController | null = null;

	function abortCurrent() {
		currentAbortController?.abort();
		currentAbortController = null;
	}

	async function executeCompute(values: T) {
		abortCurrent();

		currentAbortController = new AbortController();
		const { signal } = currentAbortController;
		const timeoutId = setTimeout(() => currentAbortController?.abort(), timeout);

		isComputing = true;
		try {
			await computeFn(values, signal);
		} catch (err) {
			if (!(err instanceof Error && err.name === 'AbortError')) {
				throw err;
			}
		} finally {
			clearTimeout(timeoutId);
			isComputing = false;
			currentAbortController = null;

			if (pendingValues !== null) {
				const next = pendingValues;
				pendingValues = null;
				executeCompute(next);
			}
		}
	}

	function trigger(values: T) {
		if (isComputing) {
			pendingValues = values;
		} else {
			executeCompute(values);
		}
	}

	function cancel() {
		pendingValues = null;
		abortCurrent();
	}

	return {
		trigger,
		get isComputing() {
			return isComputing;
		},
		get hasPending() {
			return pendingValues !== null;
		},
		cancel
	};
}
