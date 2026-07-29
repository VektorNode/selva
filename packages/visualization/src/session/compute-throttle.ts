/**
 * Compute throttle utility for managing async compute requests.
 *
 * - Only one request in-flight at a time
 * - Latest values always win (no queue)
 * - AbortController support to cancel stale requests
 * - Configurable timeout with automatic abort
 *
 * Framework-free: `isComputing` is a plain getter, and every transition of it fires
 * `onChange` so a reactive host (see `@selvajs/ui`'s rune adapter) can republish it.
 * Polling the getter without subscribing will read correct values but won't re-render.
 */
interface ComputeThrottleOptions {
	timeout?: number;
	/** Called after every `isComputing` transition. */
	onChange?: () => void;
}

/**
 * Fallback per-solve abort timeout (ms) when the caller doesn't pass one.
 * Used only by callers without a deployment-specific limit (e.g. plugin-ui
 * over WebSocket); the selva app supplies `MAX_SOLVE_DURATION_MS` from its
 * server config via `ComputeApp`'s `solveTimeoutMs` prop.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Creates a throttled compute handler that keeps only one request in-flight.
 * If a new value arrives while one is running, it overwrites the single pending
 * slot — older pending values are dropped. The pending value runs once the
 * current request finishes (or aborts).
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
	const { timeout = DEFAULT_TIMEOUT_MS, onChange } = options;

	let isComputing = false;
	let pendingValues: T | null = null;
	let currentAbortController: AbortController | null = null;

	/** Assign `isComputing` and notify only when it actually flipped. */
	function setComputing(next: boolean) {
		if (isComputing === next) return;
		isComputing = next;
		onChange?.();
	}

	function abortCurrent() {
		currentAbortController?.abort();
		currentAbortController = null;
	}

	async function executeCompute(values: T) {
		abortCurrent();

		currentAbortController = new AbortController();
		const { signal } = currentAbortController;
		const timeoutId = setTimeout(() => {
			// Cleared in `finally` on every other path, so firing means a genuine
			// timeout — the only signal for it (the abort itself is swallowed below).
			console.warn(`[Compute/throttle] solve exceeded ${timeout}ms — aborting`);
			currentAbortController?.abort();
		}, timeout);

		setComputing(true);
		try {
			await computeFn(values, signal);
		} catch (err) {
			// AbortError is expected (timeout or cancel). Non-abort errors must be
			// handled inside computeFn — re-throwing here would produce an unhandled
			// rejection because executeCompute is always called fire-and-forget.
			if (!(err instanceof Error) || (err.name !== 'AbortError' && err.name !== 'TimeoutError')) {
				console.error('[computeThrottle] unhandled error in computeFn:', err);
			}
		} finally {
			clearTimeout(timeoutId);
			setComputing(false);
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
			if (pendingValues !== null) {
				// Latest-wins: the previously-queued values are dropped, not solved.
				console.debug('[Compute/throttle] superseded pending solve (latest-wins)');
			}
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
