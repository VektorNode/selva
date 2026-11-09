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
import { createDeferredFiles, type DeferredFiles } from './deferred-files.js';
import { EMPTY_LIVE_SOLVE, reduceLiveSolve, type LiveSolveState } from '../events/live-solve.js';
import {
	applyLoadedValues,
	applySolveResult,
	applyValueChange,
	blankOutputs,
	commitSolveResult,
	createInitialState,
	ensureSolvedStep,
	inputsChangedSince,
	isRepeatOfLastSolve,
	pickInputValues,
	solvePhase,
	type SolvePhase,
	type RetainedSolveResult
} from './solve-session-core.js';

/**
 * How a solve ended, once nothing about it can change any more: a held result counts only
 * after the user accepts or rejects it, and a result a queued solve is about to replace never
 * counts. One per solve that lands, whether a host asked for it or an input change did.
 */
export type SolveSettlement =
	/**
	 * With `previewSolves`, `result.deferred` lists the outputs the preview left empty. Their files
	 * are not merged into `result` or `values`: `makeFiles()` then `files` hold them.
	 */
	| { status: 'applied'; result: RetainedSolveResult; diagnostics: SolveDiagnostic[] }
	/** A held result the user rejected or a newer solve replaced; the screen still shows the one before it. */
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
	 * The files the result on screen deferred, and the full solve that makes them. `none` when it
	 * deferred nothing, which is every result unless the schema turns `previewSolves` on.
	 */
	readonly files: DeferredFiles;
	/** Makes `files` with one full solve of the shown result's values, or joins the running one. Never rejects. */
	makeFiles(): Promise<void>;
	/** Stops the full solve `makeFiles()` started; `files` goes back to `waiting`. */
	cancelFiles(): void;
	/**
	 * What the viewer is currently showing, including the `source`/`values` pair a commit path
	 * needs. Null before the first solve, and again after `rebuild()`. Survives `reportError`: a
	 * failed solve leaves the last good geometry on screen, so a host committing what it sees
	 * should still see what produced it.
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
	 * after a new solve. For an action that needs a fresh result, such as an export. Inputs whose
	 * result the user just discarded settle as `discarded` rather than ask them again. A preview
	 * result settles as `applied` without its deferred files; see {@link SolveSettlement}.
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
	 * Resets the driver, stops listening to its live events and drops every subscriber. Call when
	 * the session is discarded: the event source can outlive it (the cloud stream belongs to the
	 * tab), and would otherwise keep feeding a session nobody reads. Inert afterwards.
	 */
	dispose(): void;
}

export interface SolveSessionArgs {
	schema: UISchema;
	scopeKey: string;
	driver: SolveDriver;
}

/** One listener's bug must not cost the others their update, or strand a solve mid-landing. */
function notifyAll<T>(listeners: Iterable<(value: T) => void>, value: T) {
	for (const listener of [...listeners]) {
		try {
			listener(value);
		} catch (err) {
			console.error('[Solve/session] listener threw:', err);
		}
	}
}

export function createSolveSession(args: SolveSessionArgs): SolveSession {
	let currentSchema = args.schema;
	// The inputs the last dispatch sent; null after a failure or abort, so the same values retry.
	let lastSent: Record<string, unknown> | null = null;
	// Survives a failure, unlike `lastSent`: a queued solve may be running on exactly these inputs.
	let lastDispatched: Record<string, unknown> | null = null;

	const state = createInitialState(currentSchema, args.scopeKey, readExternalValue);
	let disposed = false;

	const listeners = new Set<() => void>();
	const emit = () => notifyAll(listeners, undefined);

	const driverSolveFiles = args.driver.solveFiles;
	const files = createDeferredFiles(
		driverSolveFiles && ((values, signal) => driverSolveFiles.call(args.driver, values, signal)),
		emit
	);
	const showFiles = () => files.show(state.lastResult);

	const settledListeners = new Set<(settlement: SolveSettlement) => void>();
	let waiters: ((settlement: SolveSettlement) => void)[] = [];
	const ABORTED: SolveSettlement = { status: 'aborted', diagnostics: [] };

	function nextSettlement(): Promise<SolveSettlement> {
		if (disposed) return Promise.resolve(ABORTED);
		return new Promise((resolve) => waiters.push(resolve));
	}

	function settle(settlement: SolveSettlement) {
		const waiting = waiters;
		waiters = [];
		waiting.forEach((resolve) => resolve(settlement));
		notifyAll(settledListeners, settlement);
	}

	/** Resolves waiting callers without telling listeners: no solve ended, the session moved on. */
	function abandon() {
		const waiting = waiters;
		waiters = [];
		waiting.forEach((resolve) => resolve(ABORTED));
	}

	function settlementOf(result: SolveResult): SolveSettlement {
		const diagnostics = state.diagnostics;
		if (result.aborted) return { status: 'aborted', diagnostics };
		if (result.blocked) return { status: 'blocked', diagnostics };
		return { status: 'applied', result: state.lastResult!, diagnostics };
	}

	/** One solve ended. Tells subscribers, then settles unless a queued solve is about to replace it. */
	function land(settlement: () => SolveSettlement) {
		emit();
		if (!args.driver.hasQueued) settle(settlement());
	}

	/**
	 * Waiters stay: `solve()` resolves with what lands, and that is now the newer solve. Only
	 * listeners hear of it, so the dropped solve still settles exactly once.
	 */
	function dropHeld() {
		if (!state.heldResult) return;
		state.heldResult = null;
		notifyAll(settledListeners, { status: 'discarded', diagnostics: state.diagnostics });
	}

	function editedSinceSent() {
		return inputsChangedSince(currentSchema, state.values, lastDispatched);
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
		if (disposed) return;
		dropHeld();
		// Copy: state.values is the live map, and a driver may hold the payload across an
		// async solve — a later setValue must not mutate what's already in flight.
		lastSent = { ...pickInputValues(currentSchema, state.values) };
		lastDispatched = lastSent;
		// The inputs moved on, so files for the ones on screen are no longer worth waiting for.
		files.cancel();
		args.driver.solve(
			lastSent,
			currentSchema.previewSolves === true ? { solveMode: 'preview' } : undefined
		);
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
			return state.heldResult !== null;
		},

		acknowledge() {
			const held = state.heldResult;
			if (!held) return;
			state.heldResult = null;
			commitSolveResult(state, held, editedSinceSent());
			showFiles();
			land(() => settlementOf(held));
		},

		discard() {
			if (!state.heldResult) return;
			state.heldResult = null;
			state.unsolved = 'discarded';
			// `values`, `meshes` and `lastResult` are untouched: the viewer keeps showing the last
			// result the user accepted. The messages stay on `computeErrors`/`computeWarnings` so
			// the footer still explains why nothing changed.
			land(() => ({ status: 'discarded', diagnostics: state.diagnostics }));
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
		get files() {
			return files.state;
		},
		makeFiles() {
			return disposed ? Promise.resolve() : files.make();
		},
		cancelFiles() {
			files.cancel();
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
			if (applyValueChange(state, id, value, currentSchema.instanceSolve, forceSolve)) {
				dispatch();
			} else {
				emit();
			}
		},

		solve,

		ensureSolved() {
			const busy = args.driver.isSolving || args.driver.hasQueued === true;
			const step = ensureSolvedStep(state, busy);
			if (step === 'wait') return nextSettlement();
			if (step === 'solve') return solve();
			if (step === 'applied') {
				return Promise.resolve({
					status: step,
					result: state.lastResult!,
					diagnostics: state.diagnostics
				});
			}
			return Promise.resolve({ status: step, diagnostics: state.diagnostics });
		},

		onSettled(listener) {
			settledListeners.add(listener);
			return () => settledListeners.delete(listener);
		},

		loadValues(incoming) {
			if (applyLoadedValues(state, incoming, currentSchema.instanceSolve)) {
				dispatch();
			} else {
				emit();
			}
		},

		rebuild(schema, scopeKey) {
			if (disposed) return;
			// A caller waiting on the old definition's solve would otherwise get the new one's.
			abandon();
			currentSchema = schema;
			lastSent = null;
			lastDispatched = null;
			// The old definition's running solve and cached results must not reach the new one,
			// even where the two share input ids.
			args.driver.reset?.();
			Object.assign(state, createInitialState(schema, scopeKey, readExternalValue));
			showFiles();
			if (Object.keys(state.values).length > 0 && schema.instanceSolve !== false) {
				dispatch();
			} else {
				emit();
			}
		},

		report(result) {
			const rejected = result.blocked || result.aborted;
			// An aborted solve answered nothing, so whatever was dirty stays dirty.
			const edited = result.aborted === true || editedSinceSent();
			if (result.aborted) lastSent = null;
			// `finalizeResult` already dropped a rejected solve's outputs; this also nulls the
			// ones still in `values` from the previous solve, which only the session can name.
			applySolveResult(
				state,
				rejected ? { ...result, outputs: blankOutputs(currentSchema), meshes: [] } : result,
				edited
			);
			showFiles();
			// A result a queued solve replaces never asks the user anything, and never settles.
			if (args.driver.hasQueued) state.heldResult = null;
			// A held result settles on acknowledge() or discard().
			if (state.heldResult) return emit();
			land(() => settlementOf(result));
		},

		reportError(message) {
			dropHeld();
			lastSent = null;
			state.error = message;
			state.unsolved = null;
			land(() => ({ status: 'failed', error: message }));
		},

		reportAborted() {
			lastSent = null;
			state.unsolved = 'aborted';
			land(() => ABORTED);
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		notify: emit,

		dispose() {
			disposed = true;
			stopEvents?.();
			listeners.clear();
			files.show(null);
			settledListeners.clear();
			args.driver.reset?.();
			abandon();
		}
	};
}
