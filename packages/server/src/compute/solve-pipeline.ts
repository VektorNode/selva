/**
 * Transport-agnostic solve pipeline — the callable core lifted out of the app's
 * `/api/compute` route (embeddable-server-layer plan, K3).
 *
 * Given an already-resolved solve context — the `.gh` bytes, the input params +
 * user values, and a warm `SolveScheduler` (from `createClientCache`) — this
 * runs the framework-free half of a solve:
 *
 *   input tree build → scheduler.solve (with abort/timeout classification) →
 *   JSON serialize (size-guarded) → optional gzip → Server-Timing envelope.
 *
 * It returns a discriminated {@link SolveOutcome}: `ok` carries the ready-to-send
 * {@link SolveEnvelope} (body + headers + phase metrics), while the error
 * variants (`timeout`, `client_abort`, `too_large`, `compute_error`) name a
 * failure the transport maps to its own status code. Nothing here throws for an
 * expected failure and nothing here touches auth, the database, share tokens,
 * rate limits, or metric sinks — those stay app policy in the route.
 *
 * The Server-Timing string it emits IS the versioned wire contract (audit D5):
 * see {@link COMPUTE_CONTRACT_VERSION} and {@link COMPUTE_VERSION_HEADER}.
 */

import { TreeBuilder, type GrasshopperComputeResponse, type InputParam } from '@selvajs/compute';
import type { SchemaInput } from '@selvajs/schemas';
import { gzipSync } from 'node:zlib';
import { transformInputParameter } from './transform-input.js';
import type { CachedClient } from './client-cache.js';

// ============================================================================
// Wire contract version (audit D5)
// ============================================================================
//
// The /api/compute response shape (JSON body + Server-Timing phases) is now an
// explicit, versioned artifact rather than ad-hoc route output. The version
// rides an additive response header so a client can branch on it without any
// change to the existing body — bump this (and document the change) whenever the
// envelope's shape changes in a way a consumer could observe.

/** Current compute-response contract version. Additive header; bump on shape change. */
export const COMPUTE_CONTRACT_VERSION = 1 as const;
/** Response header carrying {@link COMPUTE_CONTRACT_VERSION}. */
export const COMPUTE_VERSION_HEADER = 'X-Selva-Compute-Version';

// ============================================================================
// Inputs & outcomes
// ============================================================================

/** A schema input carrying the optional numeric bounds the transform reads. */
export type PipelineInput = SchemaInput & {
	minimum?: number;
	maximum?: number;
	stepSize?: number;
};

export interface SolvePipelineArgs {
	/** The `.gh` bytes to solve (stored blob or remote fetch — resolved by the caller). */
	definitionSource: Uint8Array;
	/** Persisted input params; only those with a `paramType` are sent to the solve. */
	inputs: PipelineInput[];
	/** User-chosen values keyed by input id; missing keys fall back to the schema default. */
	values: Record<string, unknown>;
	/** Warm client bundle from `createClientCache().getClient(...)`. */
	client: CachedClient;
	/** Longest a serialized result may be (bytes) before a 413. */
	responseMaxBytes: number;
	/** Solve-deadline millis — used only to phrase the timeout message. */
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
	 * pre-solve prep. The caller owns everything before this and stamps `defLoadMs`.
	 */
	loadStartMs: number;
	/** Pre-solve "load" phase duration the caller already measured (auth + DB + fetch). */
	defLoadMs: number;
	/**
	 * Pre-solve prep sub-phase marks (`[label, ms]`), surfaced verbatim as `p_*`
	 * Server-Timing entries. The caller assembles these; the pipeline only echoes.
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
	/** Uncompressed serialized length in bytes. */
	serializedBytes: number;
	/** Gzipped length in bytes, or null when compression was skipped. */
	compressedBytes: number | null;
}

/** A ready-to-send response: body + headers + the solve result + phase metrics. */
export interface SolveEnvelope {
	/** The response body — a gzip `Uint8Array` when `encoding === 'gzip'`, else the JSON string. */
	body: string | Uint8Array;
	/** `'gzip'` when the body is compressed; absent otherwise. */
	encoding?: 'gzip';
	/** Fully-assembled response headers (Content-Type/-Length/-Encoding, Vary, Server-Timing, version). */
	headers: Record<string, string>;
	/** The solved definition — the caller reads `errors`/`warnings` for its metric record. */
	result: GrasshopperComputeResponse;
	/** Phase timings, for the caller's optional debug breakdown. */
	metrics: SolvePhaseMetrics;
}

/**
 * Discriminated result. `ok` carries the envelope; every other variant names an
 * expected failure the transport maps to a status code (the app route maps
 * timeout→504, client_abort→499, too_large→413; `compute_error` re-surfaces the
 * original error for the generic 500/503 path). `durationMs` on the error
 * variants is the solve wall time up to the failure, for the metric record.
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
	| { kind: 'compute_error'; durationMs: number; error: unknown };

// ============================================================================
// Pipeline
// ============================================================================

/**
 * Run the framework-free half of a solve and produce a typed outcome. See the
 * module doc for the phase sequence and the app/library boundary.
 */
export async function runSolvePipeline(args: SolvePipelineArgs): Promise<SolveOutcome> {
	const { client, signal } = args;

	// --- input tree build ---------------------------------------------------
	const treeBuildStart = performance.now();
	const inputTree = TreeBuilder.fromInputParams(
		args.inputs
			.filter((input) => input.paramType)
			.map((input): InputParam => transformInputParameter(input, args.values[input.id]))
	);
	const treeBuildMs = performance.now() - treeBuildStart;

	// --- solve --------------------------------------------------------------
	// Snapshot the shared telemetry sequence counters. The holders live on the
	// warm client and are written by every request on this server; with
	// maxConcurrentSolves > 1 another request can write them mid-flight. After
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
	// instead of truncating the JSON.
	let compressed: Buffer | null = null;
	let gzipMs = 0;
	if (/\bgzip\b/i.test(args.acceptEncoding) && serialized.length > 1024) {
		const gzipStart = performance.now();
		compressed = gzipSync(Buffer.from(serialized));
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

	// --- Server-Timing envelope (the versioned wire contract) ---------------
	const serverTiming = buildServerTiming({
		defLoadMs: args.defLoadMs,
		treeBuildMs,
		solveMs,
		serializeMs,
		gzipMs,
		serverTotalMs,
		rhino,
		settle,
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
		// A downstream proxy's `encode gzip` skips already-encoded responses, so
		// this never double-compresses. Vary is set on both branches.
		headers['Content-Encoding'] = 'gzip';
		headers['Content-Length'] = String(compressed.byteLength);
		envelope = { body: new Uint8Array(compressed), encoding: 'gzip', headers, result, metrics };
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

	return header;
}
