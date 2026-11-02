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

/** `run` must settle once its signal fires: the slot frees only then. */
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
		// A host's bug must not strand `isRunning`, or throw out of `finally` below.
		try {
			onChange?.();
		} catch (err) {
			console.error('[Solve/throttle] onChange threw:', err);
		}
	}

	async function execute(values: T) {
		const controller = new AbortController();
		currentAbortController = controller;
		const deadlineId = setTimeout(() => {
			console.warn(`[Solve/throttle] run exceeded ${runDeadlineMs}ms — aborting`);
			// The reason tells `run` a timeout from a cancel: one is a failure, the other not.
			controller.abort(new DOMException('Run deadline exceeded', 'TimeoutError'));
		}, runDeadlineMs);

		setRunning(true);
		try {
			await run(values, controller.signal);
		} catch (err) {
			// `execute` is called fire-and-forget, so re-throwing would be an unhandled rejection.
			if (!(err instanceof Error) || (err.name !== 'AbortError' && err.name !== 'TimeoutError')) {
				console.error('[Solve/throttle] unhandled error in run:', err);
			}
		} finally {
			clearTimeout(deadlineId);
			// Before `setRunning`: a subscriber can start the next run from inside it, and that
			// run's controller must survive this cleanup.
			if (currentAbortController === controller) currentAbortController = null;
			setRunning(false);

			if (pendingValues !== null && !isRunning) {
				const next = pendingValues;
				pendingValues = null;
				execute(next);
			}
		}
	}

	function trigger(values: T) {
		if (isRunning) {
			if (pendingValues !== null) {
				// eslint-disable-next-line no-console -- fires per frame during a slider scrub
				console.debug('[Solve/throttle] superseded pending run (latest-wins)');
			}
			pendingValues = values;
		} else {
			execute(values);
		}
	}

	function cancel() {
		pendingValues = null;
		currentAbortController?.abort();
		currentAbortController = null;
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
