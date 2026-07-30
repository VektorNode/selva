/**
 * Single-in-flight, latest-wins throttle for any async operation.
 *
 * - Only one run in-flight at a time
 * - Latest values always win (one pending slot, no queue)
 * - AbortController support to cancel stale runs
 * - Configurable timeout with automatic abort
 *
 * **Deliberately not compute-specific.** It was named `createComputeThrottle` while it
 * lived beside the HTTP solve driver, but it is generic over `T`, takes any
 * `(values, signal) => Promise<void>`, and mentions neither Rhino.Compute nor HTTP nor
 * geometry. The proof: plugin-ui drives it over a WebSocket to Grasshopper.
 *
 * Framework-free: `isRunning` is a plain getter, and every transition of it fires
 * `onChange` so a reactive host (see `@selvajs/ui`'s rune adapter) can republish it.
 * Polling the getter without subscribing will read correct values but won't re-render.
 */
interface AsyncThrottleOptions {
	timeout?: number;
	/** Called after every `isRunning` transition. */
	onChange?: () => void;
}

export interface AsyncThrottle<T> {
	trigger: (values: T) => void;
	readonly isRunning: boolean;
	readonly hasPending: boolean;
	cancel: () => void;
}

/**
 * Fallback per-run abort timeout (ms) when the caller doesn't pass one.
 * Used only by callers without a deployment-specific limit (e.g. plugin-ui
 * over WebSocket); the selva app supplies `MAX_SOLVE_DURATION_MS` from its
 * server config via `ComputeApp`'s `solveTimeoutMs` prop.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Creates a throttled handler that keeps only one run in-flight.
 * If a new value arrives while one is running, it overwrites the single pending
 * slot — older pending values are dropped. The pending value runs once the
 * current run finishes (or aborts).
 */
export function createAsyncThrottle<T>(
	run: (values: T, signal: AbortSignal) => Promise<void>,
	options: AsyncThrottleOptions = {}
): AsyncThrottle<T> {
	const { timeout = DEFAULT_TIMEOUT_MS, onChange } = options;

	let isRunning = false;
	let pendingValues: T | null = null;
	let currentAbortController: AbortController | null = null;

	/** Assign `isRunning` and notify only when it actually flipped. */
	function setRunning(next: boolean) {
		if (isRunning === next) return;
		isRunning = next;
		onChange?.();
	}

	function abortCurrent() {
		currentAbortController?.abort();
		currentAbortController = null;
	}

	async function execute(values: T) {
		abortCurrent();

		currentAbortController = new AbortController();
		const { signal } = currentAbortController;
		const timeoutId = setTimeout(() => {
			// Cleared in `finally` on every other path, so firing means a genuine
			// timeout — the only signal for it (the abort itself is swallowed below).
			console.warn(`[Solve/throttle] run exceeded ${timeout}ms — aborting`);
			currentAbortController?.abort();
		}, timeout);

		setRunning(true);
		try {
			await run(values, signal);
		} catch (err) {
			// AbortError is expected (timeout or cancel). Non-abort errors must be
			// handled inside `run` — re-throwing here would produce an unhandled
			// rejection because `execute` is always called fire-and-forget.
			if (!(err instanceof Error) || (err.name !== 'AbortError' && err.name !== 'TimeoutError')) {
				console.error('[Solve/throttle] unhandled error in run:', err);
			}
		} finally {
			clearTimeout(timeoutId);
			setRunning(false);
			currentAbortController = null;

			if (pendingValues !== null) {
				const next = pendingValues;
				pendingValues = null;
				execute(next);
			}
		}
	}

	function trigger(values: T) {
		if (isRunning) {
			if (pendingValues !== null) {
				// Latest-wins: the previously-queued values are dropped, not run.
				// `debug`, not `info`: a slider scrub fires this per frame, and it is a trace of
				// normal operation. Promoting it would spam a host's console on every drag.
				// eslint-disable-next-line no-console -- see above
				console.debug('[Solve/throttle] superseded pending run (latest-wins)');
			}
			pendingValues = values;
		} else {
			execute(values);
		}
	}

	function cancel() {
		pendingValues = null;
		abortCurrent();
	}

	return {
		trigger,
		get isRunning() {
			return isRunning;
		},
		get hasPending() {
			return pendingValues !== null;
		},
		cancel
	};
}
