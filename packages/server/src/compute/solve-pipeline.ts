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

import {
	ErrorCodes,
	RhinoComputeError,
	TreeBuilder,
	type GrasshopperComputeResponse,
	type InputParam,
	type SolveDefinition
} from '@selvajs/compute';
import type { SchemaInput } from '@selvajs/schemas';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { transformInputParameter } from './transform-input.js';
import type { CachedClient } from './client-cache.js';
import type { ByteRefOutcome } from './definition-byte-cache.js';
import { deriveSolveCacheInputKey, type SolveCacheConfigSubset } from './solve-cache-key.js';
import {
	decodeSolveCacheEntry,
	encodeSolveCacheEntry,
	gunzipEntryBody
} from './solve-cache-envelope.js';
import { gunzipSync } from 'node:zlib';

/** Async gzip (audit B8) — off the event loop, unlike the old `gzipSync`. */
const gzipAsync = promisify(gzip);

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
	/**
	 * The definition to solve. Either raw `.gh` bytes (remote fetch, or a caller
	 * that resolved them eagerly) or a `DefinitionRef` — an identity-keyed lazy
	 * loader (from the definition-byte cache) whose bytes the scheduler
	 * materializes ONLY when an upload is unavoidable. A pointer-known solve of a
	 * `DefinitionRef` moves zero bytes.
	 */
	definitionSource: SolveDefinition;
	/**
	 * When `definitionSource` is a byte-cache `DefinitionRef`, its mutable outcome
	 * so the pipeline can emit the `def_bytes` Server-Timing verdict (skipped =
	 * `load` never ran, hit = warm cache, miss = loader). Omit for raw-bytes solves.
	 */
	byteRefOutcome?: ByteRefOutcome;
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
	/**
	 * Optional durable L2 solve cache (H1). Present ONLY for live-channel solves
	 * whose definition has a caching quota > 0 — its presence IS the channel gate
	 * (zero policy conditionals in the pipeline). When set, the pipeline derives
	 * the wide input key from the transformed tree + `configSubset`, checks
	 * `lookup` before solving (a hit skips compute entirely, returning the stored
	 * gzipped envelope), and write-throughs `store` on a successful solve.
	 */
	solveCache?: SolvePipelineCacheHook;
}

/**
 * The app-supplied L2 hook. The app binds `lookup`/`store` to the org/definition/
 * version scope and the definition's quota; the pipeline supplies the SHA-256
 * `inputKey` (derived from the transformed tree + `configSubset`) and the opaque
 * encoded entry bytes. Both are best-effort — `lookup` may miss/throw (treated as
 * a miss), `store` is fire-and-forget.
 */
export interface SolvePipelineCacheHook {
	/** Solve-affecting config folded into the key (R8) — model units, tolerances, server id. */
	configSubset: SolveCacheConfigSubset;
	/** Fetch a stored entry for `inputKey`, or `null` on miss. Must not reject fatally. */
	lookup(inputKey: string): Promise<Uint8Array | null>;
	/** Store the encoded entry for `inputKey`. Fire-and-forget; best-effort. */
	store(inputKey: string, entry: Uint8Array): void;
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
	/**
	 * L2 durable-cache verdict: `true` = served from L2 (no solve ran), `false` =
	 * L2 consulted and missed (solved), `null` = L2 not consulted (no hook — draft
	 * or caching off). Drives the `l2_cache` Server-Timing entry.
	 */
	l2CacheHit: boolean | null;
}

/** A ready-to-send response: body + headers + the solve result + phase metrics. */
export interface SolveEnvelope {
	/** The response body — a gzip `Uint8Array` when `encoding === 'gzip'`, else the JSON string. */
	body: string | Uint8Array;
	/** `'gzip'` when the body is compressed; absent otherwise. */
	encoding?: 'gzip';
	/** Fully-assembled response headers (Content-Type/-Length/-Encoding, Vary, Server-Timing, version). */
	headers: Record<string, string>;
	/**
	 * The solved definition object, present only on a fresh (non-L2) solve. Absent
	 * on an L2 hit — the pipeline serves the stored gzipped body without ever
	 * materializing the object. The caller reads `errorCount`/`warningCount` off
	 * the `ok` outcome for its metric record, not this field.
	 */
	result?: GrasshopperComputeResponse;
	/** Phase timings, for the caller's optional debug breakdown. */
	metrics: SolvePhaseMetrics;
}

/**
 * Discriminated result. `ok` carries the envelope; every other variant names an
 * expected failure the transport maps to a status code (the app route maps
 * timeout→504, client_abort→499, too_large→413, shed→503+Retry-After;
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
	 * Scheduler backpressure shed the solve before it executed — the per-server
	 * queue was full (`QUEUE_FULL`) or it sat queued past the wait deadline
	 * (`QUEUE_TIMEOUT`). Retryable: the route maps this to 503 + `Retry-After`.
	 * `retryAfterSeconds` is a suggested backoff hint for the client.
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

	// --- L2 durable cache lookup (H1) ---------------------------------------
	// Derive the wide key from the TRANSFORMED tree (R13) + config subset (R8),
	// then check the injected hook. Present only for cacheable live solves — its
	// presence is the channel gate. A hit skips the solve entirely and serves the
	// stored gzipped envelope; the derived key is reused for the write-through on
	// a miss. Lookup is best-effort: any rejection is swallowed to a miss.
	let inputKey: string | null = null;
	if (args.solveCache) {
		inputKey = deriveSolveCacheInputKey(inputTree, args.solveCache.configSubset).hash;
		let stored: Uint8Array | null = null;
		try {
			stored = await args.solveCache.lookup(inputKey);
		} catch {
			stored = null;
		}
		if (stored) {
			const hit = buildEnvelopeFromCacheEntry(stored, inputKey, args);
			if (hit) return hit;
			// Corrupt/tampered entry → fall through and solve as a miss. Warn: a
			// silently-poisoned cache would otherwise look like an eternal cold key.
			console.warn(
				`[Compute/l2-cache] corrupt or hash-mismatched entry for key ${inputKey.slice(0, 16)}… — discarding, solving fresh`
			);
		}
	}

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
		// Scheduler backpressure (audit B7): a full queue or an over-deadline queue
		// wait sheds the solve BEFORE compute runs. Classify these as `shed` (503 +
		// Retry-After) rather than the generic 500 `compute_error` path — they're
		// load signals, not failures, and the client should back off and retry.
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
	// instead of truncating the JSON.
	// gzip is async (audit B8) — a multi-MB `gzipSync` blocked the event loop for
	// every other request on this instance. Two independent reasons to compress:
	//   - the client advertised gzip AND the body clears the 1 KB break-even (tiny
	//     bodies aren't worth compressing for the wire);
	//   - an L2 write-through is pending — the entry stores compressed bytes so
	//     every future hit is near-CPU-free, so we compress even a small body (it
	//     will be cached), just not for the wire below the threshold.
	const clientWantsGzip = /\bgzip\b/i.test(args.acceptEncoding);
	const worthSendingGzip = clientWantsGzip && serialized.length > 1024;
	const willCache = args.solveCache != null;
	let compressed: Buffer | null = null;
	let gzipMs = 0;
	if (worthSendingGzip || willCache) {
		const gzipStart = performance.now();
		compressed = await gzipAsync(Buffer.from(serialized));
		gzipMs = performance.now() - gzipStart;
	}

	// --- L2 write-through (H1) ----------------------------------------------
	// On a cacheable solve with a compressed body, store the gzipped envelope so
	// future hits are near-CPU-free. Fire-and-forget through the hook; the store
	// itself is best-effort (may silently drop under quota/byte pressure).
	if (args.solveCache && inputKey && compressed) {
		const entry = encodeSolveCacheEntry(
			{
				errorCount: result.errors?.length ?? 0,
				warningCount: result.warnings?.length ?? 0,
				serializedBytes: serialized.length,
				inputHash: inputKey
			},
			new Uint8Array(compressed)
		);
		args.solveCache.store(inputKey, entry);
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

	// Send gzip to the client only when it's worth it for the wire — a body
	// compressed solely to feed the L2 write-through (or one below the 1 KB
	// break-even) goes out uncompressed.
	const sendCompressed = compressed && worthSendingGzip ? compressed : null;

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
		byteRefOutcome: args.byteRefOutcome,
		// L2 was consulted (hook present) and missed — otherwise not consulted.
		l2CacheHit: args.solveCache ? false : null,
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
		compressedBytes: sendCompressed?.byteLength ?? null,
		l2CacheHit: args.solveCache ? false : null
	};

	let envelope: SolveEnvelope;
	if (sendCompressed) {
		// A downstream proxy's `encode gzip` skips already-encoded responses, so
		// this never double-compresses. Vary is set on both branches.
		headers['Content-Encoding'] = 'gzip';
		headers['Content-Length'] = String(sendCompressed.byteLength);
		envelope = {
			body: new Uint8Array(sendCompressed),
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
// Per-waiter encoding adaptation (audit C5)
// ============================================================================

/**
 * Re-key a coalesced envelope to a single waiter's `Accept-Encoding` (audit C5).
 *
 * The single-flight coalescer (R4) runs ONE pipeline execution for N identical
 * concurrent solves and hands every waiter the same {@link SolveEnvelope}. That
 * envelope's wire form — gzip body + `Content-Encoding: gzip`, or the plain JSON
 * string — is baked from the FIRST caller's `Accept-Encoding`. A later waiter
 * with a different `Accept-Encoding` would otherwise receive a body labelled with
 * the wrong encoding: a non-gzip client joining a gzip flight gets gzip bytes it
 * cannot decode (`Vary` can't help — this is one object shared across waiters,
 * not a cache lookup). Encoding is not in the coalesce key by design, so mixed
 * clients still coalesce; this adapts the shared result to each waiter instead.
 *
 * Returns the body + headers to send THIS waiter. Only the correctness-critical
 * direction is adapted — a gzip envelope served to a non-gzip waiter is gunzipped
 * back to JSON. The reverse (a plain-JSON envelope to a gzip-capable waiter) is
 * left uncompressed: gzip is an optimisation the client advertises, never a
 * requirement, so sending it plain is correct, just not maximally small. The
 * common all-gzip case returns the envelope's own body/headers untouched.
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
// L2 cache-hit envelope
// ============================================================================

/**
 * Build the `ok` outcome from a stored L2 entry — the near-CPU-free hit path (no
 * solve, no `JSON.stringify`, no gzip). Returns `null` when the entry is corrupt
 * or its stored `inputHash` doesn't match the requesting key (defense-in-depth
 * against a wide-hash collision), so the caller falls through and solves.
 */
function buildEnvelopeFromCacheEntry(
	entryBytes: Uint8Array,
	inputKey: string,
	args: SolvePipelineArgs
): (SolveOutcome & { kind: 'ok' }) | null {
	const decoded = decodeSolveCacheEntry(entryBytes);
	// A collision that produced the same storage key still can't serve the wrong
	// geometry: the stored hash must match the requesting key's hash.
	if (!decoded || decoded.header.inputHash !== inputKey) return null;

	const { header, gzippedBody } = decoded;
	const clientWantsGzip = /\bgzip\b/i.test(args.acceptEncoding);
	const serverTotalMs = performance.now() - args.loadStartMs;

	const serverTiming = buildServerTiming({
		defLoadMs: args.defLoadMs,
		treeBuildMs: 0,
		solveMs: 0,
		serializeMs: 0,
		gzipMs: 0,
		serverTotalMs,
		rhino: null,
		settle: null,
		byteRefOutcome: args.byteRefOutcome,
		l2CacheHit: true,
		prepMarks: args.prepMarks ?? []
	});

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'Server-Timing': serverTiming,
		[COMPUTE_VERSION_HEADER]: String(COMPUTE_CONTRACT_VERSION),
		Vary: 'Accept-Encoding'
	};

	const metrics: SolvePhaseMetrics = {
		treeBuildMs: 0,
		solveMs: 0,
		serializeMs: 0,
		gzipMs: 0,
		serverTotalMs,
		serializedBytes: header.serializedBytes,
		compressedBytes: clientWantsGzip ? gzippedBody.byteLength : null,
		l2CacheHit: true
	};

	let envelope: SolveEnvelope;
	if (clientWantsGzip) {
		// Serve the stored compressed bytes verbatim — the whole point of R6.
		headers['Content-Encoding'] = 'gzip';
		headers['Content-Length'] = String(gzippedBody.byteLength);
		envelope = { body: new Uint8Array(gzippedBody), encoding: 'gzip', headers, metrics };
	} else {
		// Rare non-gzip client: gunzip back to the JSON string for the response.
		const json = gunzipEntryBody(gzippedBody);
		headers['Content-Length'] = String(Buffer.byteLength(json));
		envelope = { body: json, headers, metrics };
	}

	return {
		kind: 'ok',
		envelope,
		solveMs: 0,
		errorCount: header.errorCount,
		warningCount: header.warningCount
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
	byteRefOutcome?: ByteRefOutcome;
	/** L2 verdict: true=hit, false=miss (consulted), null=not consulted. */
	l2CacheHit: boolean | null;
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

	// Durable L2 verdict (H1): 1 = hit (no solve ran), 0 = miss (consulted then
	// solved). Absent when the L2 wasn't consulted (draft channel / caching off).
	if (parts.l2CacheHit !== null) {
		header += `, l2_cache;dur=${parts.l2CacheHit ? 1 : 0}`;
	}

	return header;
}
