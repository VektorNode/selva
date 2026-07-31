import { createAsyncThrottle } from '../async-throttle.js';
import { createSolveMemo, type MeshPolicy } from '../solve-memo.js';
import type { SolveFn } from '../../shared/solve-fn.js';
import type { SolveDriver, SolveReporter } from './driver.js';

export interface RequestResponseDriverOptions<TMesh> {
	timeout?: number;
	onChange?: () => void;
	/** Mesh ownership policy for the result memo — see `MeshPolicy` (solve-memo.ts). */
	meshPolicy?: MeshPolicy<TMesh>;
}

/**
 * `getReporter` is lazy (`() => session`) because the session and driver reference each
 * other — the host builds the driver first, then the session, then can hand this back.
 */
export function createRequestResponseDriver<TMesh = unknown>(
	onSolve: SolveFn<TMesh>,
	getReporter: () => SolveReporter<TMesh>,
	options: RequestResponseDriverOptions<TMesh> = {}
): SolveDriver {
	const { meshPolicy, ...throttleOptions } = options;

	// Checked inside the throttled run, not before triggering it, so a hit only serves
	// after the throttle's latest-wins ordering has picked these values to run.
	const memo = createSolveMemo<TMesh>({ meshPolicy });

	const throttle = createAsyncThrottle<Record<string, unknown>>(async (values, signal) => {
		const cached = memo.get(values);
		if (cached !== undefined) {
			if (signal.aborted) return;
			getReporter().report(cached);
			return;
		}
		try {
			const result = await onSolve(values, signal);
			if (signal.aborted) {
				// eslint-disable-next-line no-console -- normal during a slider scrub; not a warning
				console.debug('[Solve/driver] solve completed after abort — result discarded');
				return;
			}
			memo.set(values, result);
			getReporter().report(result);
		} catch (err) {
			if (signal.aborted) {
				// eslint-disable-next-line no-console -- normal during a slider scrub; not a warning
				console.debug('[Solve/driver] solve aborted (superseded, cancelled, or timed out)');
				return;
			}
			console.warn('[Solve/driver] solve failed:', err);
			getReporter().reportError(err instanceof Error ? err.message : String(err));
		}
	}, throttleOptions);

	return {
		solve(values) {
			throttle.trigger(values);
		},
		cancel() {
			throttle.cancel();
		},
		get isSolving() {
			return throttle.isRunning;
		},
		clearCache() {
			memo.clear();
		}
	};
}
