/**
 * Runs one solve against a warm scheduler and classifies how it ended: a solved response, or an
 * expected failure as a value instead of a throw. This is the part single-flight shares, so
 * nothing here depends on who is asking.
 */

import {
	ErrorCodes,
	ComputeError,
	type ServerTiming,
	type SolveDefinition
} from '@selvajs/compute/core';
import type {
	DataTree,
	GrasshopperComputeResponse,
	SelvaEventTarget
} from '@selvajs/compute/grasshopper';
import type { CachedClient } from './client-cache.js';
import { isByteCacheRef } from './definition-byte-cache.js';
import {
	createResponseEncoder,
	type ResponseEncoder,
	type SolveEnvelope
} from './response-encoding.js';
import type { CacheVerdict, DefBytesVerdict } from './server-timing.js';

export interface SolvePipelineArgs {
	/**
	 * Raw `.gh` bytes, or a byte-cache `DefinitionRef` whose bytes the scheduler
	 * materializes only when an upload is unavoidable — a pointer-known solve
	 * moves zero bytes.
	 */
	definitionSource: SolveDefinition;
	inputTree: DataTree[];
	client: CachedClient;
	responseMaxBytes: number;
	/** Only phrases the timeout message — the scheduler enforces the deadline itself. */
	solveDeadlineMs: number;
	/** Per-solve live-event callback the compute server hands to the definition; absent when the caller opened no stream. */
	selvaEvents?: SelvaEventTarget;
	/**
	 * Forwarded to the scheduler so a client disconnect cancels the upstream
	 * compute call. Its `aborted` flag also tells that apart from an abort nobody asked for.
	 */
	signal: AbortSignal;
}

/**
 * `ok` carries the envelope; every other variant names an expected failure:
 * `SolveEngine.toWebResponse` maps each to a status. `durationMs` on error variants is the solve
 * wall time up to the failure, for the metric record.
 */
export type SolveEngineOutcome =
	| {
			kind: 'ok';
			envelope: SolveEnvelope;
			solveMs: number;
			errorCount: number;
			warningCount: number;
	  }
	| SolveFailure;

export type SolveFailure =
	| { kind: 'timeout'; durationMs: number; message: string }
	| { kind: 'client_abort'; durationMs: number }
	| { kind: 'too_large' }
	/**
	 * Retryable: no result, through no fault of the request, and `retryAfterSeconds` is a backoff
	 * hint. Scheduler backpressure rejected the solve before it ran (`queue_full`,
	 * `queue_timeout`), or its client was shut down under it (`interrupted`).
	 */
	| {
			kind: 'shed';
			durationMs: number;
			reason: 'queue_full' | 'queue_timeout' | 'interrupted';
			retryAfterSeconds: number;
			message: string;
	  }
	| { kind: 'compute_error'; durationMs: number; error: unknown };

/** One finished solve, shared by every caller coalesced onto it. */
export interface SolvedFlight {
	kind: 'solved';
	response: GrasshopperComputeResponse;
	encoder: ResponseEncoder;
	solveMs: number;
	rhino: ServerTiming | null;
	settle: CacheVerdict;
	/** The verdict of the ref that ran: a coalesced caller's own ref never loads anything. */
	defBytes?: DefBytesVerdict;
}

function shed(
	durationMs: number,
	reason: 'queue_full' | 'queue_timeout' | 'interrupted',
	message: string
): SolveFailure {
	return { kind: 'shed', durationMs, reason, retryAfterSeconds: 1, message };
}

/** The solve lost its client, and no caller asked for that: a config write or a shutdown. */
export function interrupted(durationMs: number): SolveFailure {
	return shed(durationMs, 'interrupted', 'The solve was interrupted. Retry shortly.');
}

function classifyFailure(err: unknown, durationMs: number, args: SolvePipelineArgs): SolveFailure {
	if (!(err instanceof ComputeError)) return { kind: 'compute_error', durationMs, error: err };
	switch (err.code) {
		case ErrorCodes.TIMEOUT_ERROR:
			return {
				kind: 'timeout',
				durationMs,
				message: `Solve exceeded the ${Math.round(args.solveDeadlineMs / 1000)}s deadline.`
			};
		case ErrorCodes.ABORTED:
			return args.signal.aborted ? { kind: 'client_abort', durationMs } : interrupted(durationMs);
		case ErrorCodes.RESPONSE_TOO_LARGE:
			return { kind: 'too_large' };
		// Queue-full or queue-timeout rejects the solve before compute runs — a load
		// signal, not a failure, so it's `shed` rather than `compute_error`.
		case ErrorCodes.QUEUE_FULL:
			return shed(durationMs, 'queue_full', 'Compute server is at capacity. Retry shortly.');
		case ErrorCodes.QUEUE_TIMEOUT:
			return shed(
				durationMs,
				'queue_timeout',
				'Compute request waited too long in the queue. Retry shortly.'
			);
		default:
			return { kind: 'compute_error', durationMs, error: err };
	}
}

function defBytesVerdict(source: SolveDefinition): DefBytesVerdict | undefined {
	if (!isByteCacheRef(source)) return undefined;
	const { loaded, fromCache } = source.outcome;
	return !loaded ? 'skipped' : fromCache ? 'hit' : 'miss';
}

export async function runSolvePipeline(
	args: SolvePipelineArgs
): Promise<SolvedFlight | SolveFailure> {
	let rhino: ServerTiming | null = null;
	const solveStart = performance.now();
	try {
		const detail = await args.client.scheduler.solveDetailed(
			args.definitionSource,
			args.inputTree,
			{
				signal: args.signal,
				selvaevents: args.selvaEvents,
				onServerTiming: (t) => {
					rhino = t;
				}
			}
		);
		const defBytes = defBytesVerdict(args.definitionSource);
		return {
			kind: 'solved',
			response: detail.response,
			encoder: createResponseEncoder(detail.response, args.responseMaxBytes),
			solveMs: performance.now() - solveStart,
			rhino,
			settle: { fromCache: detail.fromCache, definitionReuploaded: detail.definitionReuploaded },
			...(defBytes ? { defBytes } : {})
		};
	} catch (err) {
		return classifyFailure(err, performance.now() - solveStart, args);
	}
}
