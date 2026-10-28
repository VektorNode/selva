// A framework-free shell over the pure transition logic in solve-session-core.ts: owns the
// live values/flags, delegates every transition to the core, and drives solves through a
// transport-agnostic SolveDriver.
//
// State is exposed as plain getters; it carries no framework reactivity of its own, so a
// Svelte host must wrap it — see `useSolveSession.svelte.ts` in `@selvajs/ui`, which
// republishes these getters as $state. Reading a getter without subscribing gives a
// correct value but will not re-render.

import type { UISchema } from '@selvajs/schemas';
import { readExternalValue } from '../external-storage.js';
import type { SolveDiagnostic, SolveResult } from '../../shared/solve-fn.js';
import type { SolveDriver } from '../drivers/driver.js';
import { EMPTY_LIVE_SOLVE, reduceLiveSolve, type LiveSolveState } from '../events/live-solve.js';
import {
	buildInitialValues,
	makeInitialFlags,
	applyValueChange,
	applySolveResult,
	blankOutputs,
	commitSolveResult,
	isRepeatOfLastSolve,
	pickInputValues,
	solvePhase,
	type SolvePhase,
	type SolveSessionState,
	type RetainedSolveResult
} from './solve-session-core.js';

/**
 * How a solve ended, once nothing about it can change any more: a held result counts only
 * after the user accepts or rejects it, and a result a queued solve is about to replace never
 * counts. One per solve that lands, whether a host asked for it or an input change did.
 */
export type SolveSettlement =
	| { status: 'applied'; result: RetainedSolveResult; diagnostics: SolveDiagnostic[] }
	/** The user rejected a held result; the screen still shows the one before it. */
	| { status: 'discarded'; diagnostics: SolveDiagnostic[] }
	/** The definition refused the solve. */
	| { status: 'blocked'; diagnostics: SolveDiagnostic[] }
	/** Cancelled, or stopped in Grasshopper, before it produced a result. */
	| { status: 'aborted'; diagnostics: SolveDiagnostic[] }
	/** The transport failed or the solve ran past its deadline; `error` is what the user sees. */
	| { status: 'failed'; error: string };

export interface SolveSession {
	readonly values: Record<string, unknown>;
	readonly error: string;
	readonly computeErrors: string[];
	readonly computeWarnings: string[];
	/**
	 * The last solve's messages with their level, source and `isGate`. Richer than the two
	 * string arrays above and the list a message UI should render; they remain for hosts that
	 * only want the text. Empty from a transport that reports no structure.
	 */
	readonly diagnostics: SolveDiagnostic[];
	/**
	 * The definition refused the last solve, or it was aborted. Applied at once, not held: the
	 * outputs are blanked and the viewer cleared, and `computeErrors` holds the reason.
	 */
	readonly blocked: boolean;
	/**
	 * The last solve raised messages awaiting the user's confirmation, and its result is held
	 * back until then. A host shows the messages and calls `acknowledge()` to release them.
	 * Never true for a blocked solve.
	 */
	readonly awaitingAck: boolean;
	/**
	 * Releases a held result into the session. No-op when nothing is held. The solve already
	 * ran — this applies what it produced, it does not re-solve.
	 */
	acknowledge(): void;
	/**
	 * Drops a held result instead of applying it. The viewer keeps what it was showing. No-op
	 * when nothing is held, and never re-solves — like `acknowledge()`, it only decides the
	 * fate of a result that already exists.
	 */
	discard(): void;
	/**
	 * What the running (or most recent) solve has said so far: its diagnostics, progress per
	 * source, and how it ended. Reset when a solve with a new id starts, so a host renders "what
	 * this solve has said", never a tail of the previous one. Stays empty when the driver has no
	 * live channel.
	 */
	readonly live: LiveSolveState;
	/**
	 * Where the session is, as one value instead of four flags: `solving` while a solve runs,
	 * `review` while a result waits for `acknowledge()`, `blocked` after a refused or aborted
	 * solve, `idle` otherwise.
	 */
	readonly phase: SolvePhase;
	/**
	 * Asks the transport to stop the solve in flight. Cooperative on both paths — Grasshopper
	 * stops at the next component boundary — so the result is a `solveEnded` (or nothing, if it
	 * finished first), never an instant halt.
	 */
	abort(): void;
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
	/**
	 * Solves the current inputs. Resolves with the settlement of the solve that lands, which is
	 * a later one if the inputs change meanwhile: what is on screen when it resolves. Never
	 * rejects; a failure is a status. A rebuild or dispose first resolves it as `aborted`.
	 */
	solve(): Promise<SolveSettlement>;
	/**
	 * The result for the current inputs, solving only when it has to: right away from the result
	 * on screen when nothing changed, after the running or held solve when there is one, else
	 * after a new solve. For an action that needs a fresh result, such as an export.
	 */
	ensureSolved(): Promise<SolveSettlement>;
	/** Fires once per settled solve, the ones input changes start included. Returns the unsubscribe. */
	onSettled(listener: (settlement: SolveSettlement) => void): () => void;
	/** Merges incoming values, then solves (auto) or marks dirty (manual). */
	loadValues(incoming: Record<string, unknown>): void;
	rebuild(schema: UISchema, scopeKey: string): void;
	report(result: SolveResult): void;
	reportError(message: string): void;
	reportAborted(): void;
	/** Fires after any mutation of the getters above, including driver-reported `isSolving` transitions. */
	subscribe(listener: () => void): () => void;
	/** For driver-owned state the session only forwards: `isSolving` lives on the driver, so wire this to its `onChange`. */
	notify(): void;
	/**
	 * Stops listening to the driver's live events and drops every subscriber. Call when the
	 * session is discarded: the event source can outlive it (the cloud stream belongs to the tab),
	 * and would otherwise keep feeding a session nobody reads.
	 */
	dispose(): void;
}

export interface SolveSessionArgs {
	schema: UISchema;
	scopeKey: string;
	driver: SolveDriver;
}

export function createSolveSession(args: SolveSessionArgs): SolveSession {
	let currentSchema = args.schema;
	// The inputs the last dispatch sent; null after a failure or abort, so the same values retry.
	let lastSent: Record<string, unknown> | null = null;

	const flags = makeInitialFlags(currentSchema?.instanceSolve);
	const state: SolveSessionState = {
		values: buildInitialValues(currentSchema, args.scopeKey, readExternalValue),
		error: '',
		computeErrors: [],
		computeWarnings: [],
		diagnostics: [],
		blocked: false,
		awaitingAck: false,
		heldResult: null,
		meshes: [],
		pendingValues: {},
		hasPendingChanges: flags.hasPendingChanges,
		hasNeverSolved: flags.hasNeverSolved,
		lastResult: null
	};

	const listeners = new Set<() => void>();
	const emit = () => listeners.forEach((l) => l());

	const settledListeners = new Set<(settlement: SolveSettlement) => void>();
	let waiters: ((settlement: SolveSettlement) => void)[] = [];
	const ABORTED: SolveSettlement = { status: 'aborted', diagnostics: [] };

	function nextSettlement(): Promise<SolveSettlement> {
		return new Promise((resolve) => waiters.push(resolve));
	}

	function settle(settlement: SolveSettlement) {
		const waiting = waiters;
		waiters = [];
		waiting.forEach((resolve) => resolve(settlement));
		settledListeners.forEach((listener) => listener(settlement));
	}

	/** Resolves waiting callers without telling listeners: no solve ended, the session moved on. */
	function abandon() {
		const waiting = waiters;
		waiters = [];
		waiting.forEach((resolve) => resolve(ABORTED));
	}

	function settleResult(result: SolveResult) {
		const diagnostics = state.diagnostics;
		if (result.aborted) return settle({ status: 'aborted', diagnostics });
		if (result.blocked) return settle({ status: 'blocked', diagnostics });
		settle({ status: 'applied', result: state.lastResult!, diagnostics });
	}

	let live: LiveSolveState = EMPTY_LIVE_SOLVE;
	// A driver with no live channel never calls this; nothing else in the session depends on it.
	const stopEvents = args.driver.onEvent?.((event) => {
		const next = reduceLiveSolve(live, event);
		if (next === live) return;
		live = next;
		emit();
	});

	function solve(): Promise<SolveSettlement> {
		const settled = nextSettlement();
		dispatch();
		return settled;
	}

	function dispatch() {
		// Copy: state.values is the live map, and a driver may hold the payload across an
		// async solve — a later setValue must not mutate what's already in flight.
		lastSent = { ...pickInputValues(currentSchema, state.values) };
		args.driver.solve(lastSent);
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
		get diagnostics() {
			return state.diagnostics;
		},
		get blocked() {
			return state.blocked;
		},
		get awaitingAck() {
			return state.awaitingAck;
		},

		acknowledge() {
			if (!state.awaitingAck) return;
			const held = state.heldResult;
			state.awaitingAck = false;
			state.heldResult = null;
			if (held) commitSolveResult(state, held);
			emit();
			if (held) settleResult(held);
		},

		discard() {
			if (!state.awaitingAck) return;
			state.awaitingAck = false;
			state.heldResult = null;
			// `values`, `meshes` and `lastResult` are untouched: the viewer keeps showing the last
			// result the user accepted. The messages stay on `computeErrors`/`computeWarnings` so
			// the footer still explains why nothing changed.
			emit();
			settle({ status: 'discarded', diagnostics: state.diagnostics });
		},
		get live() {
			return live;
		},
		get phase() {
			return solvePhase(state, args.driver.isSolving);
		},
		abort() {
			args.driver.cancel();
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
			if (!forceSolve && isRepeatOfLastSolve(currentSchema, lastSent, state.values, id, value))
				return;
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

		solve,

		ensureSolved() {
			if (args.driver.isSolving || args.driver.hasQueued || state.awaitingAck) {
				return nextSettlement();
			}
			if (state.hasPendingChanges || state.hasNeverSolved || state.error || !state.lastResult) {
				return solve();
			}
			if (state.blocked) {
				return Promise.resolve({ status: 'blocked', diagnostics: state.diagnostics });
			}
			return Promise.resolve({
				status: 'applied',
				result: state.lastResult,
				diagnostics: state.diagnostics
			});
		},

		onSettled(listener) {
			settledListeners.add(listener);
			return () => settledListeners.delete(listener);
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
			// A caller waiting on the old definition's solve would otherwise get the new one's.
			abandon();
			currentSchema = schema;
			lastSent = null;
			// The new definition has its own input space; a matching input key from the prior
			// one must not serve that definition's cached result.
			args.driver.clearCache?.();
			state.meshes = [];
			// Same reason as clearCache: a retained result belongs to the previous definition.
			state.lastResult = null;
			state.error = '';
			state.computeErrors = [];
			state.computeWarnings = [];
			state.diagnostics = [];
			state.blocked = false;
			state.awaitingAck = false;
			// Belongs to the previous definition, same as lastResult.
			state.heldResult = null;
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
			if (result.aborted) lastSent = null;
			// `finalizeResult` already dropped a rejected solve's outputs; this also nulls the
			// ones still in `values` from the previous solve, which only the session can name.
			applySolveResult(
				state,
				result.blocked || result.aborted
					? { ...result, outputs: blankOutputs(currentSchema), meshes: [] }
					: result
			);
			emit();
			// A held result settles on acknowledge() or discard(); one a queued solve replaces, never.
			if (state.awaitingAck || args.driver.hasQueued) return;
			settleResult(result);
		},

		reportError(message) {
			lastSent = null;
			state.error = message;
			emit();
			if (!args.driver.hasQueued) settle({ status: 'failed', error: message });
		},

		reportAborted() {
			lastSent = null;
			emit();
			if (!args.driver.hasQueued) settle(ABORTED);
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		notify: emit,

		dispose() {
			stopEvents?.();
			listeners.clear();
			settledListeners.clear();
			abandon();
		}
	};
}
