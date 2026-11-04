// Pure transition logic for a Solve Session.
//
// This module holds the value/lifecycle state machine with no transport and no state
// ownership: how values are seeded (including client-sourced hydration), when a value
// change should dispatch a solve vs. defer it, and what a reported solve result does to
// the flags. `solve-session.ts` is a thin shell that owns the state object and the
// subscriber set; every decision lives here, which is what makes it directly testable.

import type { UISchema } from '@selvajs/schemas';
import { getDefaultValue } from '@selvajs/schemas';
import { getExternalInputs, type ExternalValueRef } from '../external-storage.js';
import type { SolveDiagnostic, SolveResult } from '../../shared/solve-fn.js';

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
	/**
	 * The same messages with their level, source and `isGate`. What decides whether a solve
	 * interrupts the user; the two string arrays above stay the plain display lists.
	 */
	diagnostics: SolveDiagnostic[];
	/**
	 * The last solve was refused by a guard in the definition. Separate from `computeErrors`
	 * being non-empty: a solve can report errors and still return usable outputs, and the UI
	 * needs to tell "solved, with complaints" from "would not solve".
	 */
	blocked: boolean;
	/**
	 * The result withheld until the user answers for it, kept whole so `acknowledge()` can apply
	 * it without a re-solve. While set, `meshes` and the solve's outputs stay at their previous
	 * values. A newer solve drops it: the user only ever confirms the most recent result.
	 */
	heldResult: SolveResult | null;
	meshes: unknown[];
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
	/**
	 * Why the result on screen does not answer the current inputs, when nothing else says so: the
	 * last solve was aborted, or the user discarded it. Nothing marks those inputs dirty, so
	 * without this `ensureSolved` would hand out the older result as theirs.
	 */
	unsolved: 'aborted' | 'discarded' | null;
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
export function createInitialState(
	schema: UISchema,
	scopeKey: string,
	read: ExternalReader
): SolveSessionState {
	const manual = schema.instanceSolve === false;
	return {
		values: buildInitialValues(schema, scopeKey, read),
		error: '',
		computeErrors: [],
		computeWarnings: [],
		diagnostics: [],
		blocked: false,
		heldResult: null,
		meshes: [],
		hasPendingChanges: manual,
		hasNeverSolved: manual,
		lastResult: null,
		unsolved: null
	};
}

/**
 * Whether the change should dispatch. Manual mode defers and raises the dirty flag instead;
 * `force` overrides that, and what it solves is every pending edit.
 */
export function applyValueChange(
	state: SolveSessionState,
	id: string,
	value: unknown,
	instanceSolve: boolean | undefined,
	force = false
): boolean {
	state.values[id] = value;
	if (instanceSolve !== false) return true;
	state.hasPendingChanges = !force;
	return force;
}

/** Same rule as `applyValueChange`, for a whole set. Whether it should dispatch. */
export function applyLoadedValues(
	state: SolveSessionState,
	incoming: Record<string, unknown>,
	instanceSolve: boolean | undefined
): boolean {
	Object.assign(state.values, incoming);
	if (instanceSolve !== false) return true;
	state.hasPendingChanges = true;
	return false;
}

// Worth sending even unchanged: a dynamic list's options can change under the same selection, and
// a file can be picked again after its parameter was cleared.
const RESEND_UNCHANGED = new Set(['dynamicValueList', 'file']);

/**
 * Whether setting `value` would solve again for nothing: it is what the last solve sent and what
 * the session holds, and nothing failed or aborted since (`lastSent` is null then). A field that
 * reports on input and again on blur would otherwise solve twice, and Grasshopper re-applies every
 * dynamic list on each update, so the repeat is a real solve. Objects never count as repeats.
 */
export function isRepeatOfLastSolve(
	schema: UISchema,
	lastSent: Record<string, unknown> | null,
	values: Record<string, unknown>,
	id: string,
	value: unknown
): boolean {
	if (!lastSent || !(id in lastSent)) return false;
	if (value !== null && typeof value === 'object') return false;
	if (!Object.is(lastSent[id], value) || !Object.is(values[id], value)) return false;
	const paramType = schema.inputs.find((input) => input.id === id)?.paramType;
	return !RESEND_UNCHANGED.has(paramType ?? '');
}

/**
 * Solve outputs live in the same `values` map as inputs (so widgets like dynamic value
 * lists can read them) but must not be echoed back to the driver: a measured 6.4 MB
 * options-list output showed this can re-upload a multi-MB payload no backend reads.
 */
export function pickInputValues(
	schema: UISchema,
	values: Record<string, unknown>
): Record<string, unknown> {
	const picked: Record<string, unknown> = {};
	for (const input of schema.inputs) {
		if (Object.hasOwn(values, input.id)) picked[input.id] = values[input.id];
	}
	return picked;
}

/** An input was edited after `sent` was dispatched, so a result for `sent` does not cover it. */
export function inputsChangedSince(
	schema: UISchema,
	values: Record<string, unknown>,
	sent: Record<string, unknown> | null
): boolean {
	if (!sent) return false;
	const current = pickInputValues(schema, values);
	return Object.keys(current).some(
		(id) => !Object.hasOwn(sent, id) || !Object.is(current[id], sent[id])
	);
}

/**
 * `editedSinceSent` keeps the dirty flag for a value changed while the solve ran: its result
 * answers the older value, and clearing the flag would hide the Calculate prompt on a stale answer.
 */
export function applySolveResult(
	state: SolveSessionState,
	result: SolveResult,
	editedSinceSent: boolean
): void {
	state.error = '';
	state.computeErrors = result.errors ?? [];
	state.computeWarnings = result.warnings ?? [];
	state.diagnostics = result.diagnostics ?? [];
	state.blocked = result.blocked ?? false;
	state.unsolved = result.aborted ? 'aborted' : null;

	// The solve is finished either way — Grasshopper cannot be paused mid-solution — so what is
	// held back here is the *result*, not the computation. Everything the solve produced is kept
	// intact in `heldResult` and released verbatim by `acknowledge()`.
	//
	// A blocked solve is applied at once: there is no result to weigh, and the previous one must
	// not stay on screen looking like the answer to the current inputs. The caller blanks the
	// outputs (see `blankOutputs`); the empty mesh list clears the viewer.
	if (!state.blocked && needsAcknowledgement(state.diagnostics)) {
		state.heldResult = result;
		state.hasPendingChanges &&= editedSinceSent;
		return;
	}

	state.heldResult = null;
	commitSolveResult(state, result, editedSinceSent);
}

/**
 * Every schema output set to null. A blocked solve reports `outputs: {}`, and merging that into
 * `values` would leave the previous solve's outputs behind.
 */
export function blankOutputs(schema: UISchema): Record<string, null> {
	const blank: Record<string, null> = {};
	for (const output of schema.outputs) blank[output.id] = null;
	return blank;
}

/** Writes a result into the state. Shared by the clean path and by `acknowledge()`. */
export function commitSolveResult(
	state: SolveSessionState,
	result: SolveResult,
	editedSinceSent: boolean
): void {
	state.meshes = result.meshes ?? [];
	const { meshes: _meshes, ...retained } = result;
	state.lastResult = retained;
	Object.assign(state.values, result.outputs);
	state.hasPendingChanges &&= editedSinceSent;
	state.hasNeverSolved = false;
}

/** What `ensureSolved` has to do for the current inputs. */
export type EnsureSolvedStep = 'wait' | 'solve' | 'discarded' | 'blocked' | 'applied';

/** `busy`: the driver is solving or has a solve queued. */
export function ensureSolvedStep(state: SolveSessionState, busy: boolean): EnsureSolvedStep {
	if (busy || state.heldResult) return 'wait';
	if (state.hasPendingChanges) return 'solve';
	// Not re-solved: the same inputs would raise the same messages and ask the user again.
	if (state.unsolved === 'discarded') return 'discarded';
	if (state.unsolved || state.hasNeverSolved || state.error || !state.lastResult) return 'solve';
	return state.blocked ? 'blocked' : 'applied';
}

export type SolvePhase = 'idle' | 'solving' | 'review' | 'blocked';

/**
 * One value for what a host should show. Solving wins: a new solve supersedes a held or refused
 * result. `isSolving` is passed in because the driver owns it.
 */
export function solvePhase(state: SolveSessionState, isSolving: boolean): SolvePhase {
	if (isSolving) return 'solving';
	if (state.heldResult) return 'review';
	if (state.blocked) return 'blocked';
	return 'idle';
}

/**
 * Whether this solve's messages still need the user's acknowledgement.
 *
 * Only a Selva Message component gates. Grasshopper raises warnings constantly for reasons that
 * concern whoever is editing the definition, not whoever is using the app — a component
 * complaining about its own inputs is not something an end user can act on, and interrupting
 * them for it trains them to dismiss the one message that mattered.
 *
 * Every solve that gates asks again, by design — an acknowledgement covers the solve in front of
 * the user, never a future one. Under `instanceSolve` with a live warning that means a dialog
 * per solve, which is the intended checkpoint, not an oversight.
 *
 * A transport that reports no structure has no diagnostics, so nothing gates: the messages are
 * still shown, just without interrupting.
 */
export function needsAcknowledgement(diagnostics: SolveDiagnostic[]): boolean {
	return diagnostics.some((d) => d.isGate && d.level !== 'remark');
}
