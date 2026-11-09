import { createAsyncThrottle } from '../async-throttle.js';
import { createSolveMemo, type MeshPolicy } from '../solve-memo.js';
import { raceAbort } from '../../shared/abort.js';
import type { SolveFn, SolveMode, SolveResult } from '../../shared/solve-fn.js';
import type { SolveDriver, SolveEventSource, SolveReporter } from './driver.js';

export interface RequestResponseDriverOptions<TMesh> {
	/** How long one solve may take before the client aborts it (ms). Pass the deadline the solve's server enforces so the two agree. */
	solveDeadlineMs: number;
	onChange?: () => void;
	/** Mesh ownership policy for the result memo — see `MeshPolicy` (solve-memo.ts). */
	meshPolicy?: MeshPolicy<TMesh>;
	/** Live events for the solves this driver runs; without it the session never sees any. */
	events?: SolveEventSource;
}

/**
 * `getReporter` is lazy (`() => session`) because the session and driver reference each
 * other — the host builds the driver first, then the session, then can hand this back.
 */
export function createRequestResponseDriver<TMesh = unknown>(
	onSolve: SolveFn<TMesh>,
	getReporter: () => SolveReporter<TMesh>,
	options: RequestResponseDriverOptions<TMesh>
): SolveDriver {
	const { meshPolicy, solveDeadlineMs, onChange, events } = options;

	// Checked inside the throttled run, not before triggering it, so a hit only serves
	// after the throttle's latest-wins ordering has picked these values to run.
	const memo = createSolveMemo<TMesh>({ meshPolicy });
	// The memo keys on values alone, so it holds one mode's results: a preview and a full result
	// of the same values differ in their files. Cleared when the mode flips.
	let memoMode: SolveMode = 'full';
	let nextMode: SolveMode = 'full';

	// Bumped by `reset`. A run from an older generation belongs to a definition that is gone: it
	// must neither fill the memo nor report into the session that replaced it.
	let generation = 0;

	// A stopped run still ends in a report: a timeout is a failure the user should read, a
	// cancel is not. Either way a host awaiting the solve hears back.
	function reportStopped(signal: AbortSignal) {
		// eslint-disable-next-line no-console -- normal during a slider scrub; not a warning
		console.debug('[Solve/driver] solve stopped (cancelled or timed out)');
		const reason = signal.reason as { name?: string } | undefined;
		if (reason?.name === 'TimeoutError') {
			getReporter().reportError(
				`The solve took longer than ${Math.round(solveDeadlineMs / 1000)} s and was stopped.`
			);
		} else {
			getReporter().reportAborted();
		}
	}

	const throttle = createAsyncThrottle<Record<string, unknown>>(
		async (values, signal) => {
			const startedIn = generation;
			const solveMode = nextMode;
			if (solveMode !== memoMode) {
				memo.clear();
				memoMode = solveMode;
			}
			let result: SolveResult<TMesh>;
			// Only the solve is inside the `try`. A report that throws is a host bug, and landing
			// here would settle a good solve a second time, as failed.
			try {
				const cached = memo.get(values);
				if (cached !== undefined) {
					result = cached;
				} else {
					// Raced: a `SolveFn` that ignores its signal must not pin the throttle's slot past
					// the deadline. Its late settlement is dropped.
					const solved = await raceAbort(
						onSolve(values, signal, solveMode === 'preview' ? { solveMode } : undefined),
						signal
					);
					// Stamped here rather than in the SolveFn: a memo hit never calls it, so values
					// captured inside would pair the served result with whatever solved last.
					result = { ...solved, values };
					// An abort is not an answer for these inputs, so the same values must solve again.
					if (!result.aborted && startedIn === generation) memo.set(values, result);
				}
			} catch (err) {
				if (startedIn !== generation) return;
				if (signal.aborted) return reportStopped(signal);
				console.warn('[Solve/driver] solve failed:', err);
				return getReporter().reportError(err instanceof Error ? err.message : String(err));
			}
			if (startedIn !== generation) return;
			if (signal.aborted) return reportStopped(signal);
			getReporter().report(result);
		},
		// The throttle is generic, so the solve deadline is what bounds one of its runs.
		{ runDeadlineMs: solveDeadlineMs, onChange }
	);

	function cancel() {
		// Dropping the fetch alone stops the Compute child: the server closes the solve and the
		// plugin's next callback gets a 410. The explicit cancel is for a server that keeps the
		// solve open, and loses the race harmlessly (404) when the fetch abort closes it first.
		throttle.cancel();
		events?.cancelCurrent?.();
	}

	return {
		solve(values, solveOptions) {
			nextMode = solveOptions?.solveMode ?? 'full';
			throttle.trigger(values);
		},
		async solveFiles(values, signal) {
			const startedIn = generation;
			// One signal for both: the deadline must abort the request itself, not just the race,
			// or the compute slot stays busy after the UI reports failure.
			const bounded = AbortSignal.any([signal, AbortSignal.timeout(solveDeadlineMs)]);
			const result = await raceAbort(
				onSolve(values, bounded, { solveMode: 'full', skipMeshes: true, liveEvents: false }),
				bounded
			);
			// The definition changed underneath: these files belong to the one that is gone.
			if (startedIn !== generation) return { outputs: {}, aborted: true };
			return result;
		},
		cancel,
		get isSolving() {
			return throttle.isRunning;
		},
		get hasQueued() {
			return throttle.hasPending;
		},
		reset() {
			generation += 1;
			cancel();
			memo.clear();
		},
		...(events ? { onEvent: (listener) => events.subscribe(listener) } : {})
	} satisfies SolveDriver;
}
