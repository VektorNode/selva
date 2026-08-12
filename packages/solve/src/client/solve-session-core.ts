// Pure transition logic for a Solve Session.
//
// This module holds the value/lifecycle state machine with no transport and no state
// ownership: how values are seeded (including client-sourced hydration), when a value
// change should dispatch a solve vs. defer it, and what a reported solve result does to
// the flags. `solve-session.ts` is a thin shell that owns the state object and the
// subscriber set; every decision lives here, which is what makes it directly testable.

import type { UISchema } from '@selvajs/schemas';
import { getDefaultValue } from '@selvajs/schemas';
import { getExternalInputs, type ExternalValueRef } from './external-storage.js';
import type { SolveResult } from '../shared/solve-fn.js';

/**
 * The slice of a reported result the session keeps addressable, so a host can commit exactly
 * what the viewer is showing — `source` and `values` included, already memo-correct.
 *
 * Mesh-free by construction. `SolveResult.meshes` are GPU-backed and the viewer disposes what
 * it renders on the next scene update, which is why the memo carries a `MeshPolicy`
 * clone/release contract at all. Retaining them here would hand out disposed instances after
 * the next solve, with no policy governing them and no owner. Everything left is inert JSON;
 * live meshes stay on `session.meshes`.
 */
export type RetainedSolveResult<TSource = unknown> = Omit<SolveResult<never, TSource>, 'meshes'>;

export interface SolveSessionState {
	values: Record<string, unknown>;
	error: string;
	computeErrors: string[];
	computeWarnings: string[];
	meshes: unknown[];
	/** Values changed since the last solve, in manual (instanceSolve === false) mode. */
	pendingValues: Record<string, unknown>;
	hasPendingChanges: boolean;
	hasNeverSolved: boolean;
	/**
	 * The last result reported, minus its meshes. Null before the first solve.
	 *
	 * Lags `values` by design: nothing updates it on `setValue` or `loadValues`, so between a
	 * value change and the next report it describes the *previous* input set. That is what a
	 * commit gate wants — what is on screen, not what is pending — so `lastResult.values`
	 * disagreeing with `state.values` mid-scrub is the feature, not a bug.
	 */
	lastResult: RetainedSolveResult | null;
}

export type ExternalReader = (ref: ExternalValueRef) => unknown | undefined;

/**
 * Client-sourced inputs are hydrated from `read` and left absent when no stored value
 * exists, so the missing-inputs panel can detect them. Other inputs fall back to their
 * declared default, then the paramType default.
 */
export function buildInitialValues(
	schema: UISchema,
	scopeKey: string,
	read: ExternalReader
): Record<string, unknown> {
	const clientSet = new Set(getExternalInputs(schema).map((e) => e.paramId));
	const values: Record<string, unknown> = {};
	for (const input of schema.inputs) {
		if (clientSet.has(input.id)) {
			const stored = read({ scopeKey, inputId: input.id });
			if (stored !== undefined) values[input.id] = stored;
			continue;
		}
		values[input.id] = input.default ?? getDefaultValue(input.paramType);
	}
	for (const output of schema.outputs) {
		values[output.id] = null;
	}
	return values;
}

/** Manual-solve schemas (instanceSolve === false) start dirty; auto-solve schemas start clean. */
export function makeInitialFlags(instanceSolve: boolean | undefined): {
	hasPendingChanges: boolean;
	hasNeverSolved: boolean;
} {
	const manual = instanceSolve === false;
	return { hasPendingChanges: manual, hasNeverSolved: manual };
}

/** Manual mode defers (records the pending value, raises the dirty flag) instead of solving. */
export function applyValueChange(
	state: SolveSessionState,
	id: string,
	value: unknown,
	instanceSolve: boolean | undefined
): { state: SolveSessionState; shouldSolve: boolean } {
	state.values[id] = value;
	if (instanceSolve === false) {
		state.pendingValues[id] = value;
		state.hasPendingChanges = true;
		return { state, shouldSolve: false };
	}
	return { state, shouldSolve: true };
}

/**
 * Solve outputs live in the same `values` map as inputs (so widgets like dynamic value
 * lists can read them) but must not be echoed back to the driver: a measured 6.4 MB
 * options-list output showed this can re-upload a multi-MB payload no backend reads.
 */
export function pickInputValues(
	schema: UISchema | undefined,
	values: Record<string, unknown>
): Record<string, unknown> {
	if (!schema?.inputs) return values;
	const picked: Record<string, unknown> = {};
	for (const input of schema.inputs) {
		if (input.id in values) picked[input.id] = values[input.id];
	}
	return picked;
}

export function applySolveResult(state: SolveSessionState, result: SolveResult): SolveSessionState {
	state.error = '';
	state.computeErrors = result.errors ?? [];
	state.computeWarnings = result.warnings ?? [];
	state.meshes = result.meshes ?? [];
	const { meshes: _meshes, ...retained } = result;
	state.lastResult = retained;
	Object.assign(state.values, result.outputs);
	state.pendingValues = {};
	state.hasPendingChanges = false;
	state.hasNeverSolved = false;
	return state;
}
