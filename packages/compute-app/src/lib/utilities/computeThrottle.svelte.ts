/**
 * Compute throttle utility for managing async compute requests.
 *
 * Features:
 * - Only one request in-flight at a time
 * - Latest values always sent (no queue, just "latest wins")
 * - AbortController support to cancel stale requests
 * - Configurable timeout with automatic abort
 *
 * Flow:
 * 1. User changes value → request sent immediately
 * 2. User changes value while request in-flight → current request aborted, new one starts
 * 3. Result: server never overwhelmed, always processing latest values
 */

export interface ComputeThrottleOptions {
	/** Timeout in milliseconds. Default: 60000 (60 seconds) */
	timeout?: number;
}

export function createComputeThrottle<T>(
	computeFn: (values: T, signal: AbortSignal) => Promise<void>,
	options: ComputeThrottleOptions = {}
): {
	/** Trigger a compute with the given values */
	trigger: (values: T) => void;
	/** Whether a compute is currently in progress */
	readonly isComputing: boolean;
	/** Whether there are pending values waiting to be sent */
	readonly hasPending: boolean;
	/** Cancel any in-flight request */
	cancel: () => void;
} {
	const { timeout = 60000 } = options;

	let isComputing = $state(false);
	let pendingValues = $state<T | null>(null);
	let currentAbortController: AbortController | null = null;

	function abortCurrent() {
		if (currentAbortController) {
			currentAbortController.abort();
			currentAbortController = null;
		}
	}

	async function executeCompute(values: T) {
		// Abort any existing request
		abortCurrent();

		// Create new abort controller with timeout
		currentAbortController = new AbortController();
		const signal = currentAbortController.signal;

		// Set up timeout
		const timeoutId = setTimeout(() => {
			if (currentAbortController) {
				currentAbortController.abort(new Error(`Request timed out after ${timeout}ms`));
			}
		}, timeout);

		isComputing = true;
		try {
			await computeFn(values, signal);
		} catch (err) {
			// Re-throw unless it's an abort (which we handle silently for cancellation)
			if (err instanceof Error && err.name === 'AbortError') {
				// Check if there are pending values - if so, this was intentional cancellation
				if (pendingValues === null) {
					// Timeout or manual cancel without pending values - rethrow
					throw err;
				}
				// Otherwise, silently ignore - we're about to process pending values
			} else {
				throw err;
			}
		} finally {
			clearTimeout(timeoutId);
			isComputing = false;
			currentAbortController = null;

			// If values changed while we were computing, send the latest
			if (pendingValues !== null) {
				const next = pendingValues;
				pendingValues = null;
				executeCompute(next);
			}
		}
	}

	function trigger(values: T) {
		if (isComputing) {
			// Store latest values and abort current request
			pendingValues = values;
			abortCurrent();
		} else {
			// No request in-flight, send immediately
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
