// Reactive Solve Session (see CONTEXT.md): the $state-backed shell over the pure
// transition logic in solve-session-core.ts. It owns the live values/flags, delegates
// every transition to the core, and drives solves through a transport-agnostic
// SolveDriver. A completed solve re-enters via report().

import type { UISchema } from '@selvajs/schemas';
import { readExternalValue } from '../external/storage';
import type { SolveFn, SolveResult } from '../types/solveFn';
import { createComputeThrottle } from './computeThrottle.svelte';
import {
	buildInitialValues,
	makeInitialFlags,
	applyValueChange,
	applySolveResult,
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
		args.driver.solve($state.snapshot(state.values));
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
	const throttle = createComputeThrottle<Record<string, unknown>>(async (values, signal) => {
		try {
			const result = await onSolve(values, signal);
			if (signal.aborted) return;
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
		}
	};
}
