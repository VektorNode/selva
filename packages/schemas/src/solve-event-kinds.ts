// How each live solve event kind may be delivered: the only per-kind rule a transport needs.
// Hand-written because the codegen drops custom schema keywords. The C# twin is
// Plugin/Selva.Schema/Constants/SolveEventKinds.cs; fixtures/solve/event-kinds.json holds the
// table both test suites compare against.

import type {
	ProgressPayload,
	SolveDiagnostic,
	SolveEndedPayload,
	SolveStartedPayload
} from './generated/wire.js';

/**
 * - `critical`: never dropped, never coalesced.
 * - `latest`: only the newest per coalesce key matters; older ones may be replaced or dropped.
 * - `bestEffort`: dropped first under pressure. The class of every kind not in the table.
 */
export type SolveEventDelivery = 'critical' | 'latest' | 'bestEffort';

export interface SolveEventKindRule {
	delivery: SolveEventDelivery;
	/** For `latest`: the payload field that keys coalescing, so each source keeps its newest. */
	coalesceBy?: string;
}

export const SOLVE_EVENT_KINDS = {
	solveStarted: { delivery: 'critical' },
	solveEnded: { delivery: 'critical' },
	diagnostic: { delivery: 'critical' },
	progress: { delivery: 'latest', coalesceBy: 'source' }
} as const satisfies Record<string, SolveEventKindRule>;

export type KnownSolveEventType = keyof typeof SOLVE_EVENT_KINDS;

/** The payload each known kind carries. An unknown kind's payload is an open object. */
export interface SolveEventPayloads {
	solveStarted: SolveStartedPayload;
	solveEnded: SolveEndedPayload;
	diagnostic: SolveDiagnostic;
	progress: ProgressPayload;
}

export function solveEventDelivery(type: string): SolveEventDelivery {
	return (SOLVE_EVENT_KINDS as Record<string, SolveEventKindRule>)[type]?.delivery ?? 'bestEffort';
}

/**
 * Two `latest` events with the same key supersede each other. Null for every other class: those
 * are never coalesced.
 */
export function solveEventCoalesceKey(event: {
	type: string;
	payload?: Record<string, unknown> | null;
}): string | null {
	const rule = (SOLVE_EVENT_KINDS as Record<string, SolveEventKindRule>)[event.type];
	if (rule?.delivery !== 'latest') return null;
	const key = rule.coalesceBy ? event.payload?.[rule.coalesceBy] : undefined;
	return `${event.type}:${typeof key === 'string' ? key : ''}`;
}
