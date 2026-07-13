// Reactive Solve Session (see CONTEXT.md): the $state-backed shell over the pure
// transition logic in solve-session-core.ts. It owns the live values/flags, delegates
// every transition to the core, and drives solves through a transport-agnostic
// SolveDriver. A completed solve re-enters via report().

import type { UISchema } from '@selvajs/schemas';
import { readExternalValue } from '../external/storage';
import type { SolveFn, SolveResult } from '../types/solveFn';
import { createComputeThrottle } from './computeThrottle.svelte';
import { createSolveMemo } from './solveMemo';
import {
	buildInitialValues,
	makeInitialFlags,
	applyValueChange,
	applySolveResult,
	pickInputValues,
	type SolveSessionState
} from './solve-session-core';

/**
 * The transport behind a Solve Session. Knows how to start and cancel a solve and
 * reports its in-flight state. It does NOT return outputs — those come back via the
 * session's report() so push transports (WebSocket) fit without contortion.
 */
export interface SolveDriver {
	solve(values: Record<string, unknown>): void;
	cancel(): void;
	readonly isSolving: boolean;
	/**
	 * Drops any cached solve results the driver holds. Optional — only drivers with a
	 * client-side memo (the request/response driver) implement it. Called on rebuild so a
	 * definition swap can't serve a stale result from a prior definition's input space.
	 */
	clearCache?(): void;
}

export interface SolveSession {
	readonly values: Record<string, unknown>;
	readonly error: string;
	readonly computeErrors: string[];
	readonly computeWarnings: string[];
	readonly meshes: unknown[];
	readonly hasPendingChanges: boolean;
	readonly hasNeverSolved: boolean;
	readonly isSolving: boolean;
	/**
	 * Records a value change and dispatches a solve unless the schema is manual-solve.
	 * `forceSolve` overrides manual mode for system-initiated reconciliation (e.g. a dynamic
	 * value list pruning a vanished selection), so the output can't lag behind the new value.
	 */
	setValue(id: string, value: unknown, forceSolve?: boolean): void;
	/** Explicit "calculate" — dispatches a solve with the current values. */
	solve(): void;
	/** Merges incoming values, then solves (auto) or marks dirty (manual). */
	loadValues(incoming: Record<string, unknown>): void;
	/** Re-seed for a new active definition: rebuild values, clear outputs, gate the solve. */
	rebuild(schema: UISchema, scopeKey: string): void;
	/** Feed a completed solve result back into the session (called by the driver/host). */
	report(result: SolveResult): void;
	/** Report a solve failure (transport/solver error) — surfaces in `error`. */
	reportError(message: string): void;
}

export interface SolveSessionArgs {
	schema: UISchema;
	scopeKey: string;
	driver: SolveDriver;
}

export function createSolveSession(args: SolveSessionArgs): SolveSession {
	let currentSchema = args.schema;

	const flags = makeInitialFlags(currentSchema?.instanceSolve);
	const state = $state<SolveSessionState>({
		values: buildInitialValues(currentSchema, args.scopeKey, readExternalValue),
		error: '',
		computeErrors: [],
		computeWarnings: [],
		meshes: [],
		pendingValues: {},
		hasPendingChanges: flags.hasPendingChanges,
		hasNeverSolved: flags.hasNeverSolved
	});

	function dispatch() {
		// Input values only: outputs merged into state.values (for widgets that read
		// them, e.g. dynamic value lists) must not be echoed back to the transport.
		args.driver.solve(pickInputValues(currentSchema, $state.snapshot(state.values)));
	}

	return {
		get values() {
			return state.values;
		},
		get error() {
			return state.error;
		},
		get computeErrors() {
			return state.computeErrors;
		},
		get computeWarnings() {
			return state.computeWarnings;
		},
		get meshes() {
			return state.meshes;
		},
		get hasPendingChanges() {
			return state.hasPendingChanges;
		},
		get hasNeverSolved() {
			return state.hasNeverSolved;
		},
		get isSolving() {
			return args.driver.isSolving;
		},

		setValue(id, value, forceSolve = false) {
			const { shouldSolve } = applyValueChange(state, id, value, currentSchema?.instanceSolve);
			if (shouldSolve || forceSolve) {
				// A forced solve reconciles the deferred output; clear the dirty flags it raised.
				if (forceSolve && !shouldSolve) {
					state.pendingValues = {};
					state.hasPendingChanges = false;
				}
				dispatch();
			}
		},

		solve() {
			dispatch();
		},

		loadValues(incoming) {
			Object.assign(state.values, incoming);
			if (currentSchema?.instanceSolve !== false) {
				dispatch();
			} else {
				state.hasPendingChanges = true;
			}
		},

		rebuild(schema, scopeKey) {
			currentSchema = schema;
			// Drop the driver's result memo: the new definition has its own input space, so
			// a matching input key from the prior definition must not serve its stale result.
			args.driver.clearCache?.();
			state.meshes = [];
			state.error = '';
			state.computeErrors = [];
			state.computeWarnings = [];
			state.pendingValues = {};
			state.values = buildInitialValues(schema, scopeKey, readExternalValue);
			const f = makeInitialFlags(schema?.instanceSolve);
			state.hasPendingChanges = f.hasPendingChanges;
			state.hasNeverSolved = f.hasNeverSolved;
			if (schema && Object.keys(state.values).length > 0 && schema.instanceSolve !== false) {
				dispatch();
			}
		},

		report(result) {
			applySolveResult(state, result);
		},

		reportError(message) {
			state.error = message;
		}
	};
}

/** The slice of a SolveSession a driver feeds completed/failed solves back into. */
export interface SolveReporter {
	report(result: SolveResult): void;
	reportError(message: string): void;
}

/**
 * Request/response Solve Driver: wraps createComputeThrottle around a SolveFn and feeds
 * the resolved result back through the reporter. One solve in flight at a time; the
 * latest triggered values win. Used by ComputeApp (Rhino.Compute over HTTP).
 *
 * Because the session and driver reference each other, the host passes the reporter
 * lazily (`() => session`) so it can construct the session with the driver in hand.
 */
export function createRequestResponseDriver(
	onSolve: SolveFn,
	getReporter: () => SolveReporter,
	options: { timeout?: number } = {}
): SolveDriver {
	// M2: a small LRU memoizing completed solves by their input values. A slider dragged
	// back to a value already solved this session reports instantly without a network
	// round-trip. The check lives inside the throttled computeFn so the throttle's
	// latest-wins ordering still holds — a hit only serves after the throttle picks these
	// values as the ones to run.
	const memo = createSolveMemo();

	const throttle = createComputeThrottle<Record<string, unknown>>(async (values, signal) => {
		const cached = memo.get(values);
		if (cached !== undefined) {
			if (signal.aborted) return;
			getReporter().report(cached);
			return;
		}
		try {
			const result = await onSolve(values, signal);
			if (signal.aborted) return;
			memo.set(values, result);
			getReporter().report(result);
		} catch (err) {
			if (signal.aborted) return;
			getReporter().reportError(err instanceof Error ? err.message : String(err));
		}
	}, options);

	return {
		solve(values) {
			throttle.trigger(values);
		},
		cancel() {
			throttle.cancel();
		},
		get isSolving() {
			return throttle.isComputing;
		},
		clearCache() {
			memo.clear();
		}
	};
}
