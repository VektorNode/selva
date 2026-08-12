// A framework-free shell over the pure transition logic in solve-session-core.ts: owns the
// live values/flags, delegates every transition to the core, and drives solves through a
// transport-agnostic SolveDriver.
//
// State is exposed as plain getters; it carries no framework reactivity of its own, so a
// Svelte host must wrap it — see `useSolveSession.svelte.ts` in `@selvajs/ui`, which
// republishes these getters as $state. Reading a getter without subscribing gives a
// correct value but will not re-render.

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
	type SolveSessionState,
	type RetainedSolveResult
} from './solve-session-core.js';

export interface SolveSession {
	readonly values: Record<string, unknown>;
	readonly error: string;
	readonly computeErrors: string[];
	readonly computeWarnings: string[];
	readonly meshes: unknown[];
	/**
	 * The last reported result without its meshes — what the viewer is currently showing,
	 * including the `source`/`values` pair a commit path needs. Null before the first solve,
	 * and again after `rebuild()`. Survives `reportError`: a failed solve leaves the last good
	 * geometry on screen, so a host committing what it sees should still see what produced it.
	 */
	readonly lastResult: RetainedSolveResult | null;
	readonly hasPendingChanges: boolean;
	readonly hasNeverSolved: boolean;
	readonly isSolving: boolean;
	/** `forceSolve` overrides manual mode for system-initiated reconciliation (e.g. a dynamic value list pruning a vanished selection), so the output can't lag behind the new value. */
	setValue(id: string, value: unknown, forceSolve?: boolean): void;
	solve(): void;
	/** Merges incoming values, then solves (auto) or marks dirty (manual). */
	loadValues(incoming: Record<string, unknown>): void;
	rebuild(schema: UISchema, scopeKey: string): void;
	report(result: SolveResult): void;
	reportError(message: string): void;
	/** Fires after any mutation of the getters above, including driver-reported `isSolving` transitions. */
	subscribe(listener: () => void): () => void;
	/** For driver-owned state the session only forwards: `isSolving` lives on the driver, so wire this to its `onChange`. */
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
		hasNeverSolved: flags.hasNeverSolved,
		lastResult: null
	};

	const listeners = new Set<() => void>();
	const emit = () => listeners.forEach((l) => l());

	function dispatch() {
		// Copy: state.values is the live map, and a driver may hold the payload across an
		// async solve — a later setValue must not mutate what's already in flight.
		args.driver.solve({ ...pickInputValues(currentSchema, state.values) });
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
		get lastResult() {
			return state.lastResult;
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
				if (forceSolve && !shouldSolve) {
					state.pendingValues = {};
					state.hasPendingChanges = false;
				}
				dispatch();
			} else {
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
			// The new definition has its own input space; a matching input key from the prior
			// one must not serve that definition's cached result.
			args.driver.clearCache?.();
			state.meshes = [];
			// Same reason as clearCache: a retained result belongs to the previous definition.
			state.lastResult = null;
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
