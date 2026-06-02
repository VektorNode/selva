// Pure, framework-free transition logic for a Solve Session (see CONTEXT.md).
//
// This module holds the value/lifecycle state machine with no Svelte runes and no
// transport: how values are seeded (including client-sourced hydration), when a value
// change should dispatch a solve vs. defer it, and what a reported solve result does to
// the flags. The reactive wrapper in createSolveSession.svelte.ts is a thin shell over
// these functions; everything testable lives here.

import type { UISchema } from '@selvajs/schemas';
import { getDefaultValue } from '../schema/defaults';
import { getExternalInputs, type ExternalValueRef } from '../external/storage';
import type { SolveResult } from '../types/solveFn';

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
}

/** Reads a previously produced client-sourced value, or undefined if absent. */
export type ExternalReader = (ref: ExternalValueRef) => unknown | undefined;

/**
 * Builds the initial `values` map for a schema. Non-client inputs get their declared
 * default (falling back to the paramType default); client-sourced inputs are hydrated
 * from `read` and left absent when no stored value exists so the missing-inputs panel
 * can detect them. Outputs are seeded to null.
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

/**
 * Initial lifecycle flags. Manual-solve schemas (instanceSolve === false) start dirty
 * so the user must explicitly calculate; auto-solve schemas start clean.
 */
export function makeInitialFlags(instanceSolve: boolean | undefined): {
	hasPendingChanges: boolean;
	hasNeverSolved: boolean;
} {
	const manual = instanceSolve === false;
	return { hasPendingChanges: manual, hasNeverSolved: manual };
}

/**
 * Records a single value change and decides whether it should dispatch a solve now.
 * Auto-solve mode dispatches immediately; manual mode defers (records the pending value
 * and raises the dirty flag) and never dispatches.
 */
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
 * Merges a reported solve result into the state and clears the post-solve lifecycle
 * flags. Missing result arrays are treated as empty.
 */
export function applySolveResult(state: SolveSessionState, result: SolveResult): SolveSessionState {
	state.error = '';
	state.computeErrors = result.errors ?? [];
	state.computeWarnings = result.warnings ?? [];
	state.meshes = result.meshes ?? [];
	Object.assign(state.values, result.outputs);
	state.pendingValues = {};
	state.hasPendingChanges = false;
	state.hasNeverSolved = false;
	return state;
}
