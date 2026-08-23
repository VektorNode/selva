/**
 * Single-in-flight, latest-wins throttle for any async operation: only one run at a
 * time, a newly triggered value overwrites the single pending slot (no queue), and a
 * stale run can be aborted via `AbortController` or timeout.
 *
 * Framework-free: `isRunning` is a plain getter, not a store. A reactive host must
 * subscribe via `onChange` (see `@selvajs/ui`'s rune adapter) — polling the getter
 * directly reads correct values but won't trigger a re-render.
 */
interface AsyncThrottleOptions {
	/**
	 * How long one run may take before it is aborted (ms). Required and deliberately
	 * undefaulted: this is a generic throttle, so it has no basis for guessing what
	 * the caller's work costs. Callers driving a Selva solve pass the deadline the
	 * server enforces (`COMPUTE_SOLVE_DEADLINE_MS`) — a shorter local guess would abort
	 * solves the server would have finished.
	 */
	runDeadlineMs: number;
	onChange?: () => void;
}

export interface AsyncThrottle<T> {
	trigger: (values: T) => void;
	readonly isRunning: boolean;
	readonly hasPending: boolean;
	cancel: () => void;
}

export function createAsyncThrottle<T>(
	run: (values: T, signal: AbortSignal) => Promise<void>,
	options: AsyncThrottleOptions
): AsyncThrottle<T> {
	const { runDeadlineMs, onChange } = options;

	let isRunning = false;
	let pendingValues: T | null = null;
	let currentAbortController: AbortController | null = null;

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
		const deadlineId = setTimeout(() => {
			// Cleared in `finally` on every other path, so firing means a genuine
			// timeout — the only signal for it (the abort itself is swallowed below).
			console.warn(`[Solve/throttle] run exceeded ${runDeadlineMs}ms — aborting`);
			currentAbortController?.abort();
		}, runDeadlineMs);

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
			clearTimeout(deadlineId);
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
