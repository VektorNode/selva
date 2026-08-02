/**
 * Transport-agnostic solve pipeline: given an already-resolved solve context
 * (`.gh` bytes, input params + user values, a warm `SolveScheduler`), runs the
 * solve and returns a discriminated {@link SolveOutcome} instead of throwing
 * for expected failures. Auth, the database, share tokens, rate limits, and
 * metric sinks are the calling route's job, not this file's.
 */

import {
	ErrorCodes,
	RhinoComputeError,
	TreeBuilder,
	type DataTree,
	type GrasshopperComputeResponse,
	type InputParam,
	type SolveDefinition
} from '@selvajs/compute';
import type { SchemaInput } from '@selvajs/schemas';
import { gzip, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { transformInputParameter } from './transform-input.js';
import type { CachedClient } from './client-cache.js';
import type { ByteRefOutcome } from './definition-byte-cache.js';

// gzipSync blocks the event loop for multi-MB bodies; promisify(gzip) doesn't.
const gzipAsync = promisify(gzip);

// ============================================================================
// Wire contract version
// ============================================================================

/** Compute-response contract version. Bump (and document the change) whenever the envelope's shape changes in a way a consumer could observe. */
export const COMPUTE_CONTRACT_VERSION = 1 as const;
export const COMPUTE_VERSION_HEADER = 'X-Selva-Compute-Version';

// ============================================================================
// Inputs & outcomes
// ============================================================================

export type PipelineInput = SchemaInput & {
	minimum?: number;
	maximum?: number;
	stepSize?: number;
};

export interface SolvePipelineArgs {
	/**
	 * Raw `.gh` bytes, or a byte-cache `DefinitionRef` whose bytes the scheduler
	 * materializes only when an upload is unavoidable — a pointer-known solve
	 * moves zero bytes.
	 */
	definitionSource: SolveDefinition;
	/** Mutable load outcome for a `DefinitionRef` source, so the `def_bytes` Server-Timing verdict can be emitted. Omit for raw-bytes solves. */
	byteRefOutcome?: ByteRefOutcome;
	/** Persisted input params; only those with a `paramType` are sent to the solve. */
	inputs: PipelineInput[];
	/**
	 * A tree the caller already built with {@link buildSolveInputTree}; skips the
	 * pipeline's own build and solves this object directly.
	 *
	 * A caller coalescing concurrent solves needs this: a single-flight key
	 * derived from raw `{inputs, values}` would split two requests that transform
	 * to the same tree, which is the identity the scheduler actually caches on.
	 */
	inputTree?: DataTree[];
	/** User-chosen values keyed by input id; missing keys fall back to the schema default. */
	values: Record<string, unknown>;
	client: CachedClient;
	responseMaxBytes: number;
	/** Only phrases the timeout message — the scheduler enforces the deadline itself. */
	maxSolveDurationMs: number;
	/** Client's `Accept-Encoding`; gzip is applied only when it advertises `gzip`. */
	acceptEncoding: string;
	/**
	 * Forwarded to the scheduler so a client disconnect cancels the upstream
	 * compute call. Its `aborted` flag also distinguishes a client disconnect
	 * from the scheduler's own deadline firing.
	 */
	signal: AbortSignal;
	/** Wall-clock origin (`performance.now()` at the top of the request) so `load`/`total` phase timings line up with the caller's pre-solve prep. */
	loadStartMs: number;
	/** Pre-solve "load" phase duration the caller already measured (auth + DB + fetch). */
	defLoadMs: number;
	/** Pre-solve prep sub-phase marks (`[label, ms]`), surfaced verbatim as `p_*` Server-Timing entries. */
	prepMarks?: [string, number][];
}

/** Phase timings the pipeline measured; the caller uses them for debug logging. */
export interface SolvePhaseMetrics {
	treeBuildMs: number;
	solveMs: number;
	serializeMs: number;
	gzipMs: number;
	serverTotalMs: number;
	serializedBytes: number;
	/** Null when compression was skipped. */
	compressedBytes: number | null;
}

/** A ready-to-send response: body + headers + the solve result + phase metrics. */
export interface SolveEnvelope {
	/** A gzip `Uint8Array` when `encoding === 'gzip'`, else the JSON string. */
	body: string | Uint8Array;
	encoding?: 'gzip';
	headers: Record<string, string>;
	result: GrasshopperComputeResponse;
	metrics: SolvePhaseMetrics;
}

/**
 * `ok` carries the envelope; every other variant names an expected failure the
 * calling route maps to a status code (timeout→504, client_abort→499,
 * too_large→413, shed→503+Retry-After, compute_error→generic 500/503).
 * `durationMs` on error variants is the solve wall time up to the failure, for
 * the metric record.
 */
export type SolveOutcome =
	| {
			kind: 'ok';
			envelope: SolveEnvelope;
			solveMs: number;
			errorCount: number;
			warningCount: number;
	  }
	| { kind: 'timeout'; durationMs: number; message: string }
	| { kind: 'client_abort'; durationMs: number }
	| { kind: 'too_large' }
	/** Scheduler backpressure rejected the solve before it ran: queue was full (`queue_full`) or the wait exceeded the deadline (`queue_timeout`). Retryable — `retryAfterSeconds` is a backoff hint. */
	| {
			kind: 'shed';
			durationMs: number;
			reason: 'queue_full' | 'queue_timeout';
			retryAfterSeconds: number;
			message: string;
	  }
	| { kind: 'compute_error'; durationMs: number; error: unknown };

// ============================================================================
// Pipeline
// ============================================================================

/** The transformed input tree exactly as handed to the scheduler; `runSolvePipeline` calls this itself unless the caller supplies {@link SolvePipelineArgs.inputTree}. */
export function buildSolveInputTree(
	inputs: PipelineInput[],
	values: Record<string, unknown>
): DataTree[] {
	return TreeBuilder.fromInputParams(
		inputs
			.filter((input) => input.paramType)
			.map((input): InputParam => transformInputParameter(input, values[input.id]))
	);
}

export async function runSolvePipeline(args: SolvePipelineArgs): Promise<SolveOutcome> {
	const { client, signal } = args;

	const treeBuildStart = performance.now();
	const inputTree = args.inputTree ?? buildSolveInputTree(args.inputs, args.values);
	const treeBuildMs = performance.now() - treeBuildStart;

	// client.solveMeta/rhinoTiming live on the warm client and are written by
	// every request on this server; with scheduler maxConcurrent > 1, another
	// request can write them mid-flight. A slot is attributed to THIS request
	// only if exactly one write happened since this snapshot — for solveMeta
	// that single settle is necessarily ours, since onSettle fires before
	// scheduler.solve() resolves. Anything ambiguous is dropped from
	// Server-Timing rather than misattributed.
	const settleSeqBefore = client.solveMeta.seq;
	const rhinoSeqBefore = client.rhinoTiming.seq;

	let result: GrasshopperComputeResponse;
	const solveStart = performance.now();
	try {
		result = await client.scheduler.solve(args.definitionSource, inputTree, { signal });
	} catch (err) {
		const durationMs = performance.now() - solveStart;
		// AbortError with the request signal NOT aborted means the scheduler's own
		// deadline timer fired, not a client disconnect.
		const isAbort = err instanceof Error && err.name === 'AbortError';
		if (isAbort) {
			if (signal.aborted) return { kind: 'client_abort', durationMs };
			return {
				kind: 'timeout',
				durationMs,
				message: `Solve exceeded the ${Math.round(args.maxSolveDurationMs / 1000)}s deadline.`
			};
		}
		// Queue-full or queue-timeout rejects the solve before compute runs — a load
		// signal, not a failure, so it's `shed` rather than `compute_error`.
		if (err instanceof RhinoComputeError) {
			if (err.code === ErrorCodes.QUEUE_FULL) {
				return {
					kind: 'shed',
					durationMs,
					reason: 'queue_full',
					retryAfterSeconds: 1,
					message: 'Compute server is at capacity. Retry shortly.'
				};
			}
			if (err.code === ErrorCodes.QUEUE_TIMEOUT) {
				return {
					kind: 'shed',
					durationMs,
					reason: 'queue_timeout',
					retryAfterSeconds: 1,
					message: 'Compute request waited too long in the queue. Retry shortly.'
				};
			}
		}
		return { kind: 'compute_error', durationMs, error: err };
	}
	const solveMs = performance.now() - solveStart;

	const serializeStart = performance.now();
	let serialized: string;
	try {
		serialized = JSON.stringify(result);
	} catch (err) {
		// V8 caps a string at ~512 MB; an oversized `file` output trips a RangeError
		// here. Treat it the same as the byte cap: too_large.
		if (err instanceof RangeError) return { kind: 'too_large' };
		throw err;
	}
	if (serialized.length > args.responseMaxBytes) return { kind: 'too_large' };
	const serializeMs = performance.now() - serializeStart;

	// Buffered, not streamed, so Content-Length is known upfront and a connection
	// cut mid-transfer fails hard instead of silently truncating the JSON. Below
	// 1 KB gzip isn't worth the CPU for the wire savings.
	const clientWantsGzip = /\bgzip\b/i.test(args.acceptEncoding);
	const worthSendingGzip = clientWantsGzip && serialized.length > 1024;
	let compressed: Buffer | null = null;
	let gzipMs = 0;
	if (worthSendingGzip) {
		const gzipStart = performance.now();
		compressed = await gzipAsync(Buffer.from(serialized));
		gzipMs = performance.now() - gzipStart;
	}

	const serverTotalMs = performance.now() - args.loadStartMs;

	// rhino is only meaningful when settle is ours AND it was a real compute call
	// (a Selva-cache hit never reaches the server), and only unambiguous when
	// exactly one Server-Timing callback fired in the window.
	const settle = client.solveMeta.seq === settleSeqBefore + 1 ? client.solveMeta.last : null;
	const rhino =
		settle && !settle.fromCache && client.rhinoTiming.seq === rhinoSeqBefore + 1
			? client.rhinoTiming.last
			: null;

	const serverTiming = buildServerTiming({
		defLoadMs: args.defLoadMs,
		treeBuildMs,
		solveMs,
		serializeMs,
		gzipMs,
		serverTotalMs,
		rhino,
		settle,
		byteRefOutcome: args.byteRefOutcome,
		prepMarks: args.prepMarks ?? []
	});

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'Server-Timing': serverTiming,
		[COMPUTE_VERSION_HEADER]: String(COMPUTE_CONTRACT_VERSION),
		Vary: 'Accept-Encoding'
	};

	const metrics: SolvePhaseMetrics = {
		treeBuildMs,
		solveMs,
		serializeMs,
		gzipMs,
		serverTotalMs,
		serializedBytes: serialized.length,
		compressedBytes: compressed?.byteLength ?? null
	};

	let envelope: SolveEnvelope;
	if (compressed) {
		// Content-Encoding tells a downstream proxy the body is already compressed,
		// so it won't gzip it again.
		headers['Content-Encoding'] = 'gzip';
		headers['Content-Length'] = String(compressed.byteLength);
		envelope = {
			body: new Uint8Array(compressed),
			encoding: 'gzip',
			headers,
			result,
			metrics
		};
	} else {
		headers['Content-Length'] = String(Buffer.byteLength(serialized));
		envelope = { body: serialized, headers, result, metrics };
	}

	return {
		kind: 'ok',
		envelope,
		solveMs,
		errorCount: result.errors?.length ?? 0,
		warningCount: result.warnings?.length ?? 0
	};
}

// ============================================================================
// Per-waiter encoding adaptation
// ============================================================================

/**
 * Re-key a coalesced envelope to a single waiter's `Accept-Encoding`.
 *
 * The single-flight coalescer runs ONE pipeline execution for N identical
 * concurrent solves and hands every waiter the same {@link SolveEnvelope},
 * baked from the FIRST caller's `Accept-Encoding`. A later waiter with a
 * different `Accept-Encoding` would otherwise get a body labelled with the
 * wrong encoding — `Vary` can't help here, since it's one shared object, not a
 * cache lookup. Encoding is deliberately left out of the coalesce key so mixed
 * clients still coalesce; this adapts the shared result to each waiter instead.
 *
 * Only the correctness-critical direction is adapted: a gzip envelope served to
 * a non-gzip waiter is gunzipped back to JSON. The reverse (plain JSON to a
 * gzip-capable waiter) is left uncompressed — correct, just not maximally small.
 */
export function adaptEnvelopeToEncoding(
	envelope: SolveEnvelope,
	acceptEncoding: string
): { body: string | Uint8Array; headers: Record<string, string> } {
	const waiterWantsGzip = /\bgzip\b/i.test(acceptEncoding);

	// Only mismatch that corrupts the response: gzip body, non-gzip waiter.
	// Every other combination is already wire-correct.
	if (envelope.encoding === 'gzip' && !waiterWantsGzip) {
		const json = gunzipSync(
			envelope.body instanceof Uint8Array ? envelope.body : Buffer.from(envelope.body)
		).toString('utf8');
		const headers = { ...envelope.headers };
		delete headers['Content-Encoding'];
		headers['Content-Length'] = String(Buffer.byteLength(json));
		return { body: json, headers };
	}

	return { body: envelope.body, headers: envelope.headers };
}

// ============================================================================
// Server-Timing assembly
// ============================================================================

interface ServerTimingParts {
	defLoadMs: number;
	treeBuildMs: number;
	solveMs: number;
	serializeMs: number;
	gzipMs: number;
	serverTotalMs: number;
	rhino: CachedClient['rhinoTiming']['last'];
	settle: CachedClient['solveMeta']['last'];
	byteRefOutcome?: ByteRefOutcome;
	prepMarks: [string, number][];
}

/**
 * `total` is the server's headers-to-out wall time, so browser `ttfb − total`
 * ≈ network+send latency. When the compute server reports its own
 * decode/solve/encode (VektorNode fork), `rhino_*` is time on the compute
 * server and `compute_link` is everything between it (network + queue wait).
 */
function buildServerTiming(parts: ServerTimingParts): string {
	let header =
		`load;dur=${parts.defLoadMs.toFixed(1)}, ` +
		`tree;dur=${parts.treeBuildMs.toFixed(1)}, ` +
		`solve;dur=${parts.solveMs.toFixed(1)}, ` +
		`serialize;dur=${parts.serializeMs.toFixed(1)}, ` +
		`gzip;dur=${parts.gzipMs.toFixed(1)}, ` +
		`total;dur=${parts.serverTotalMs.toFixed(1)}`;

	const rhino = parts.rhino;
	if (rhino) {
		const onRhinoMs = rhino.decode + rhino.solve + rhino.encode;
		const computeLinkMs = Math.max(0, parts.solveMs - onRhinoMs);
		header +=
			`, rhino_decode;dur=${rhino.decode.toFixed(1)}` +
			`, rhino_solve;dur=${rhino.solve.toFixed(1)}` +
			`, rhino_encode;dur=${rhino.encode.toFixed(1)}` +
			`, compute_link;dur=${computeLinkMs.toFixed(1)}`;
	}

	for (const [label, ms] of parts.prepMarks) {
		header += `, p_${label};dur=${ms.toFixed(1)}`;
	}

	const settle = parts.settle;
	if (settle) {
		header += `, selva_cache;dur=${settle.fromCache ? 1 : 0}`;
		if (settle.definitionReuploaded !== undefined) {
			header += `, def_reupload;dur=${settle.definitionReuploaded ? 1 : 0}`;
		}
	}

	// skipped = scheduler never materialized bytes (pointer-known solve, the
	// whole point of this path); hit = warm byte cache; miss = fell through to
	// storage. Absent for raw-bytes solves.
	const byteRef = parts.byteRefOutcome;
	if (byteRef) {
		const verdict = !byteRef.loaded ? 'skipped' : byteRef.fromCache ? 'hit' : 'miss';
		header += `, def_bytes;desc=${verdict}`;
	}

	return header;
}
