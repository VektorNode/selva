/**
 * Transport-agnostic solve pipeline: given an already-resolved solve context
 * (`.gh` bytes, input params + user values, a warm `SolveScheduler`), runs the
 * framework-free half of a solve and returns a discriminated {@link SolveOutcome}
 * instead of throwing for expected failures. Nothing here touches auth, the
 * database, share tokens, rate limits, or metric sinks — those stay app policy
 * in the route that calls this.
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

/** Async gzip — off the event loop, unlike `gzipSync`, which blocks it for multi-MB bodies. */
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
	 * The definition to solve. Either raw `.gh` bytes, or a `DefinitionRef` (from
	 * the definition-byte cache) whose bytes the scheduler materializes ONLY when
	 * an upload is unavoidable — a pointer-known solve of a `DefinitionRef` moves
	 * zero bytes.
	 */
	definitionSource: SolveDefinition;
	/**
	 * When `definitionSource` is a byte-cache `DefinitionRef`, its mutable outcome
	 * so the pipeline can emit the `def_bytes` Server-Timing verdict. Omit for
	 * raw-bytes solves.
	 */
	byteRefOutcome?: ByteRefOutcome;
	/** Persisted input params; only those with a `paramType` are sent to the solve. */
	inputs: PipelineInput[];
	/**
	 * A tree the caller already built with {@link buildSolveInputTree}. When present
	 * the pipeline skips its own build and solves this exact object.
	 *
	 * Needed whenever the caller coalesces concurrent solves: a single-flight key
	 * derived from raw `{inputs, values}` would split two requests that transform
	 * to the same tree, which is the identity the scheduler actually caches on.
	 */
	inputTree?: DataTree[];
	/** User-chosen values keyed by input id; missing keys fall back to the schema default. */
	values: Record<string, unknown>;
	client: CachedClient;
	responseMaxBytes: number;
	/** Used only to phrase the timeout message — the scheduler enforces the deadline itself. */
	maxSolveDurationMs: number;
	/** Client's `Accept-Encoding`; gzip is applied only when it advertises `gzip`. */
	acceptEncoding: string;
	/**
	 * Request abort signal, forwarded to the scheduler so a client disconnect
	 * cancels the upstream compute call. Its `aborted` flag also disambiguates a
	 * client disconnect from the scheduler's own deadline firing.
	 */
	signal: AbortSignal;
	/**
	 * Wall-clock origin (`performance.now()` captured at the top of the request)
	 * so the pipeline's `load`/`total` phase timings line up with the caller's
	 * pre-solve prep.
	 */
	loadStartMs: number;
	/** Pre-solve "load" phase duration the caller already measured (auth + DB + fetch). */
	defLoadMs: number;
	/**
	 * Pre-solve prep sub-phase marks (`[label, ms]`), surfaced verbatim as `p_*`
	 * Server-Timing entries.
	 */
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
 * Discriminated result. `ok` carries the envelope; every other variant names an
 * expected failure the transport maps to a status code (the app route maps
 * timeout→504, client_abort→499, too_large→413, shed (rejected under backpressure)→503+Retry-After;
 * `compute_error` re-surfaces the original error for the generic 500/503 path).
 * `durationMs` on the error variants is the solve wall time up to the failure,
 * for the metric record.
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
	/**
	 * Scheduler backpressure rejected the solve before it executed — the
	 * per-server queue was full (`QUEUE_FULL`) or it sat queued past the wait
	 * deadline (`QUEUE_TIMEOUT`). Retryable: the route maps this to 503 +
	 * `Retry-After`. `retryAfterSeconds` is a suggested backoff hint for the client.
	 */
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

/**
 * Build the transformed input tree — the exact object handed to the scheduler.
 * `runSolvePipeline` calls this itself; a caller only needs it directly to see
 * the tree before the pipeline runs (see {@link SolvePipelineArgs.inputTree}).
 */
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

	// --- input tree build ---------------------------------------------------
	const treeBuildStart = performance.now();
	const inputTree = args.inputTree ?? buildSolveInputTree(args.inputs, args.values);
	const treeBuildMs = performance.now() - treeBuildStart;

	// --- solve --------------------------------------------------------------
	// Snapshot the shared telemetry sequence counters. The holders live on the
	// warm client and are written by every request on this server; with the
	// scheduler's maxConcurrent > 1 another request can write them mid-flight. After
	// the solve, a slot is attributed to THIS request only when exactly one
	// write happened since this snapshot — for solveMeta that single settle is
	// necessarily ours (onSettle fires before scheduler.solve() resolves).
	// Anything ambiguous is dropped from Server-Timing, never misattributed.
	const settleSeqBefore = client.solveMeta.seq;
	const rhinoSeqBefore = client.rhinoTiming.seq;

	let result: GrasshopperComputeResponse;
	const solveStart = performance.now();
	try {
		result = await client.scheduler.solve(args.definitionSource, inputTree, { signal });
	} catch (err) {
		const durationMs = performance.now() - solveStart;
		// Distinguish timeout (scheduler deadline timer) from client disconnect
		// (request signal). AbortError with the request signal NOT aborted means
		// the scheduler's own timeout fired — the solve genuinely timed out.
		const isAbort = err instanceof Error && err.name === 'AbortError';
		if (isAbort) {
			if (signal.aborted) return { kind: 'client_abort', durationMs };
			return {
				kind: 'timeout',
				durationMs,
				message: `Solve exceeded the ${Math.round(args.maxSolveDurationMs / 1000)}s deadline.`
			};
		}
		// A full queue or an over-deadline queue wait rejects the solve BEFORE compute
		// runs. Classify these as `shed` rather than the generic `compute_error` —
		// they're load signals, not failures, and the client should back off and retry.
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

	// --- serialize (size-guarded) ------------------------------------------
	const serializeStart = performance.now();
	let serialized: string;
	try {
		serialized = JSON.stringify(result);
	} catch (err) {
		// V8 caps a single string at ~512 MB; an oversized `file` output trips a
		// RangeError here. Surface it as the same too-large outcome as the byte cap.
		if (err instanceof RangeError) return { kind: 'too_large' };
		throw err;
	}
	if (serialized.length > args.responseMaxBytes) return { kind: 'too_large' };
	const serializeMs = performance.now() - serializeStart;

	// --- gzip ---------------------------------------------------------------
	// Compress BEFORE the timing snapshot so its cost is a measured phase (`gzip`
	// in Server-Timing, included in `total`). Buffered (not streamed) so
	// Content-Length is known and a connection cut mid-transfer fails hard
	// instead of truncating the JSON. Skip gzip for bodies under the 1 KB
	// break-even — not worth the CPU for the wire savings.
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

	// --- per-request telemetry attribution (see snapshot above) -------------
	// settle: ours iff exactly one settle happened since the snapshot. rhino:
	// only meaningful when the settle is ours AND it was a real compute call
	// (a Selva-cache hit never reaches the server), and only unambiguous when
	// exactly one Server-Timing callback fired in the window.
	const settle = client.solveMeta.seq === settleSeqBefore + 1 ? client.solveMeta.last : null;
	const rhino =
		settle && !settle.fromCache && client.rhinoTiming.seq === rhinoSeqBefore + 1
			? client.rhinoTiming.last
			: null;

	// --- Server-Timing envelope ----------------------------------------------
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
		// A downstream proxy skips re-encoding an already-`Content-Encoding`d body,
		// so this never double-compresses.
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
 * concurrent solves and hands every waiter the same {@link SolveEnvelope}. That
 * envelope's wire form is baked from the FIRST caller's `Accept-Encoding`, so a
 * later waiter with a different `Accept-Encoding` would otherwise get a body
 * labelled with the wrong encoding (`Vary` can't help — this is one object
 * shared across waiters, not a cache lookup). Encoding is deliberately not part
 * of the coalesce key, so mixed clients still coalesce; this adapts the shared
 * result to each waiter instead.
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

	// The only mismatch that corrupts the response: a gzip body handed to a waiter
	// that did not advertise gzip. Gunzip it back to the JSON string and drop the
	// encoding headers. Every other combination is already wire-correct.
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
 * Assemble the `Server-Timing` header. The browser reads these to attribute its
 * round-trip: `total` here == the server's headers-to-out wall time, so browser
 * `ttfb − total` ≈ network+send latency. When the compute server reported its
 * own decode/solve/encode (VektorNode fork), `rhino_*` is time ON the compute
 * server and `compute_link` is everything between (network + queue wait). Prep
 * sub-phases ride as `p_*`; cache verdicts as 0/1 `selva_cache`/`def_reupload`.
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

	// Byte-cache verdict for `DefinitionRef` solves: skipped = the scheduler never
	// materialized bytes (pointer-known solve — the whole point of this path), hit
	// = warm byte cache, miss = fell through to storage. Absent for raw-bytes solves.
	const byteRef = parts.byteRefOutcome;
	if (byteRef) {
		const verdict = !byteRef.loaded ? 'skipped' : byteRef.fromCache ? 'hit' : 'miss';
		header += `, def_bytes;desc=${verdict}`;
	}

	return header;
}
