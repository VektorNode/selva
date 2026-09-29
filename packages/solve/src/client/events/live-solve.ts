// What the running (or most recent) solve has said over the live channel, folded into one state
// a host can render. Pure: `reduceLiveSolve` returns a new state when an event changes something
// and the same object when it does not, so a host can compare by reference.
//
// One case per known kind. An unknown kind is kept in `other`, untouched, so a newer plugin's
// events reach a host that knows them without this package having to.

import type { ProgressPayload, SolveEvent } from '@selvajs/schemas';
import { decodeOutcome } from '../../shared/outcome.js';
import type { SolveDiagnostic } from '../../shared/solve-fn.js';

export interface LiveSolveState {
	/** The solve these events belong to; null before the first event. */
	readonly solveId: string | null;
	/** Between that solve's first event and its `solveEnded`. */
	readonly running: boolean;
	/** `diagnostic` events in arrival order. */
	readonly diagnostics: readonly SolveDiagnostic[];
	/** The newest `progress` per source. A report without a source is keyed by `''`. */
	readonly progress: ReadonlyMap<string, ProgressPayload>;
	/** `solveEnded`'s payload once it arrives: `ok`, `blocked`, `aborted` or `error`. */
	readonly ended: { readonly kind: string } | null;
	/** Events of kinds this package does not know, oldest first. */
	readonly other: readonly SolveEvent[];
	/** Highest `seq` applied for this solve. A late or repeated delivery at or below it is ignored. */
	readonly lastSeq: number;
}

export const EMPTY_LIVE_SOLVE: LiveSolveState = Object.freeze({
	solveId: null,
	running: false,
	diagnostics: [],
	progress: new Map(),
	ended: null,
	other: [],
	lastSeq: 0
});

export function reduceLiveSolve(state: LiveSolveState, event: SolveEvent): LiveSolveState {
	// A new id starts a new solve: nothing the previous one said carries over.
	const base: LiveSolveState =
		event.solveId === state.solveId
			? state
			: { ...EMPTY_LIVE_SOLVE, solveId: event.solveId, running: true };
	if (event.seq <= base.lastSeq) return state;
	const next = { ...base, lastSeq: event.seq };
	const payload = (event.payload ?? {}) as Record<string, unknown>;

	switch (event.type) {
		case 'solveStarted':
			return { ...next, running: true };

		case 'solveEnded':
			return {
				...next,
				running: false,
				ended: { kind: typeof payload.kind === 'string' ? payload.kind : 'ok' }
			};

		case 'diagnostic': {
			// Same normalization as a finished solve's messages, so a live row and its final
			// counterpart are the same object shape.
			const [diagnostic] = decodeOutcome({ diagnostics: [payload] })?.diagnostics ?? [];
			return diagnostic ? { ...next, diagnostics: [...next.diagnostics, diagnostic] } : next;
		}

		case 'progress': {
			const source = typeof payload.source === 'string' ? payload.source : '';
			const progress = new Map(next.progress);
			progress.set(source, readProgress(payload));
			return { ...next, progress };
		}

		default:
			return { ...next, other: [...next.other, event] };
	}
}

function readProgress(payload: Record<string, unknown>): ProgressPayload {
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
	const fraction = num(payload.fraction);
	const done = num(payload.done);
	const total = num(payload.total);
	return {
		...(typeof payload.source === 'string' ? { source: payload.source } : {}),
		...(fraction !== undefined ? { fraction: Math.min(1, Math.max(0, fraction)) } : {}),
		...(done !== undefined ? { done } : {}),
		...(total !== undefined ? { total } : {}),
		...(typeof payload.label === 'string' ? { label: payload.label } : {})
	};
}
