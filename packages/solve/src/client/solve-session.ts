// The Solve Session: a framework-free shell over the pure transition logic in
// solve-session-core.ts. It owns the live values/flags, delegates every transition to the
// core, and drives solves through a transport-agnostic SolveDriver. A completed solve
// re-enters via report().
//
// State is exposed as plain getters and every mutation fires `onChange` subscribers. It
// carries no framework reactivity of its own, so a Svelte host must wrap it — see
// `useSolveSession.svelte.ts` in `@selvajs/ui`, which republishes these getters as $state.
// Reading a getter without subscribing gives a correct value but will not re-render.

import type { UISchema } from '@selvajs/schemas';
import { readExternalValue } from './external-storage.js';
import type { SolveResult } from '../shared/solve-fn.js';
import type { SolveDriver } from './drivers/driver.js';
import {
	buildInitialValues,
	makeInitialFlags,
	applyValueChange,
	applySolveResult,
	pickInputValues,
	type SolveSessionState
} from './solve-session-core.js';

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
	/**
	 * Subscribe to state changes. Fires after any mutation of the getters above,
	 * including `isSolving` transitions the driver reports. Returns an unsubscribe fn.
	 *
	 * This is the seam that replaces the session's former `$state` backing: a reactive
	 * host subscribes once and republishes into its own framework's reactivity.
	 */
	subscribe(listener: () => void): () => void;
	/**
	 * Fire subscribers without changing session state. For driver-owned state the session
	 * only forwards — `isSolving` lives on the driver, so a transition there is invisible
	 * here until someone says so. Wire it to the driver's `onChange`.
	 */
	notify(): void;
}

export interface SolveSessionArgs {
	schema: UISchema;
	scopeKey: string;
	driver: SolveDriver;
}

export function createSolveSession(args: SolveSessionArgs): SolveSession {
	let currentSchema = args.schema;

	const flags = makeInitialFlags(currentSchema?.instanceSolve);
	const state: SolveSessionState = {
		values: buildInitialValues(currentSchema, args.scopeKey, readExternalValue),
		error: '',
		computeErrors: [],
		computeWarnings: [],
		meshes: [],
		pendingValues: {},
		hasPendingChanges: flags.hasPendingChanges,
		hasNeverSolved: flags.hasNeverSolved
	};

	const listeners = new Set<() => void>();
	const emit = () => listeners.forEach((l) => l());

	function dispatch() {
		// Input values only: outputs merged into state.values (for widgets that read
		// them, e.g. dynamic value lists) must not be echoed back to the transport.
		//
		// `values` is a plain object here (it was a rune proxy before this layer moved out
		// of Svelte), so it needs no snapshot — but it IS the live map, and a driver may
		// hold it across an async solve. Copy so a later setValue can't mutate a payload
		// already handed to the transport.
		args.driver.solve({ ...pickInputValues(currentSchema, state.values) });
		// The driver's isSolving almost certainly just flipped.
		emit();
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
			} else {
				// Manual mode deferred the solve — dispatch didn't run, so emit the value +
				// dirty-flag change here.
				emit();
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
				emit();
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
			} else {
				// No dispatch to emit for us — publish the cleared outputs and re-seeded values.
				emit();
			}
		},

		report(result) {
			applySolveResult(state, result);
			emit();
		},

		reportError(message) {
			state.error = message;
			emit();
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		notify: emit
	};
}
