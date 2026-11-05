import type { ServerLimits } from '@selvajs/compute/grasshopper';

/** Rhino.Compute's own default `--timeout`, for a server that can't report its own. */
export const DEFAULT_SOLVE_DEADLINE_MS = 100_000;

/**
 * Ceiling on any solve deadline, whatever the server reports. Bounds how long a request, its
 * live-event token and a delegated session stay open; past an hour a solve belongs in a job.
 */
export const MAX_SOLVE_DEADLINE_MS = 60 * 60_000;

/** Selva waits this much past the server's timeout, so Compute's own error arrives first. */
const DEADLINE_SLACK_MS = 5_000;

/** What Selva holds a solve to on one compute server. */
export interface SolveLimits {
	solveDeadlineMs: number;
	/** `null` when the server didn't say: its own 413 is then the only check. */
	maxRequestBytes: number | null;
	/**
	 * Send a pointer to the server's cached definition instead of the `.gh`. Only on a server that
	 * answers a stale pointer with `definition_not_cached`: one that doesn't returns empty geometry.
	 */
	reuseDefinitionCache: boolean;
}

export function solveLimitsFor(reported: ServerLimits | null): SolveLimits {
	if (!reported) {
		return {
			solveDeadlineMs: DEFAULT_SOLVE_DEADLINE_MS,
			maxRequestBytes: null,
			reuseDefinitionCache: false
		};
	}
	return {
		solveDeadlineMs: Math.min(
			reported.timeoutSeconds * 1000 + DEADLINE_SLACK_MS,
			MAX_SOLVE_DEADLINE_MS
		),
		maxRequestBytes: reported.maxRequestBytes,
		reuseDefinitionCache: reported.signalsStaleDefinition
	};
}

export function sameSolveLimits(a: SolveLimits, b: SolveLimits): boolean {
	return (
		a.solveDeadlineMs === b.solveDeadlineMs &&
		a.maxRequestBytes === b.maxRequestBytes &&
		a.reuseDefinitionCache === b.reuseDefinitionCache
	);
}
