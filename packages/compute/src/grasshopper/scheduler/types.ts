// Public declarations for the solve scheduler. The class itself lives in `solve-scheduler.ts`.

import type { RhinoComputeError } from '@/core/errors';
import type { RetryPolicy } from '@/core/types';

import type { DataTree, GrasshopperComputeResponse, GrasshopperComputeConfig } from '../types';
import type { SolveDefinition } from '../definition-ref';

/**
 * Scheduling mode — controls how concurrent `solve()` calls interact.
 *
 * - `latest-wins`: One in flight at a time. New calls supersede any pending
 *   call (in-flight one is aborted). Optimal for slider scrubs / live UIs.
 * - `queue`: FIFO queue. Each solve runs to completion. Concurrency capped
 *   by `maxConcurrent`. Use for "submit job" flows where every request matters.
 * - `parallel`: No scheduling — calls run concurrently up to `maxConcurrent`.
 *   Closest to plain `client.solve()` but with shared cancel/state.
 */
export type SchedulerMode = 'latest-wins' | 'queue' | 'parallel';

export interface CacheOptions {
	/**
	 * Total byte budget for retained responses, evicted LRU. The only size bound
	 * there is: responses range KB→100s of MB, so memory is the constraint that
	 * matters and an entry count would only obscure it.
	 *
	 * Sizing uses the response's wire size (JSON text length, recorded at the
	 * fetch boundary — no re-serialization); a response without that hint
	 * (custom executor) is sized by a one-off `JSON.stringify`. A single
	 * response larger than the whole budget is served but never retained.
	 *
	 * Required and must be > 0 — to disable caching, pass `cache: false`.
	 */
	maxBytes: number;
	/**
	 * Time-to-live in ms. Set to `0` for no expiry (default, and the right
	 * choice for a solve keyed by immutable definition+inputs — expiry there
	 * only buys a paid re-solve of an identical answer). Meaningful only when a
	 * definition reaches outside its inputs (external data source, clock), where
	 * a stale result is genuinely wrong rather than merely old.
	 *
	 * Expiry is evaluated lazily on read: an expired entry keeps its bytes
	 * counted against `maxBytes` until that exact key is next consulted.
	 */
	ttlMs?: number;
	/**
	 * Cache responses that carry Grasshopper `errors`. Default `true`: an
	 * errored solve is a valid, deterministic result — definitions raise GH
	 * errors by design (guarded components, validation branches), so replaying
	 * one from cache is correct. Set `false` for parity with Rhino's opt-in
	 * `cacheerroredsolves` server flag, e.g. when a definition's errors are
	 * transient (external data sources) rather than functions of the inputs.
	 */
	cacheErroredSolves?: boolean;
}

export interface SolveSchedulerOptions {
	mode?: SchedulerMode;
	maxConcurrent?: number;
	/**
	 * Backpressure — cap on how many calls may wait in the FIFO queue (i.e.
	 * excluding the ones already in flight). When the queue is full, a new
	 * `solve()` is shed immediately with `code: QUEUE_FULL` (retryable, meant to
	 * map to HTTP 503 + Retry-After) instead of piling up unbounded. Bounds the
	 * miss path under load. Only applies to `queue` / `parallel` modes —
	 * `latest-wins` has an intrinsic depth of 1. Default: unbounded.
	 */
	maxQueueDepth?: number;
	/**
	 * Backpressure — max time (ms) a call may sit queued before it starts
	 * executing. If it's still waiting after this long it's shed with
	 * `code: QUEUE_TIMEOUT` rather than burning compute on a stale request.
	 * Bounds tail latency. Only applies to `queue` / `parallel` modes. Default:
	 * no deadline.
	 */
	queueWaitMs?: number;
	timeoutMs?: number;
	retry?: RetryPolicy;
	/**
	 * Response caching keyed by hash of (definition, dataTree). Omit or pass
	 * `false` to disable; otherwise a byte budget is required, so an unbounded
	 * cache can't be enabled by accident.
	 */
	cache?: false | CacheOptions;
	/**
	 * Reuse the server's definition cache key so a large (base64/binary)
	 * definition is uploaded once and subsequent solves reference it by
	 * `pointer` instead of re-sending the full payload. Hugely cheaper for
	 * multi-MB definitions on a live UI (slider scrubs, etc.).
	 *
	 * Requires a `cacheKeyExecutor` to be supplied (the client wires one). Has no
	 * effect for URL-pointer definitions (already a reference). On a server-side
	 * cache miss the executor transparently falls back to a full upload, so this
	 * is safe to leave on. Default: `true` when a `cacheKeyExecutor` is present.
	 */
	reuseServerDefinitionCache?: boolean;
	/** Lifecycle hooks — fired in order. Errors thrown by hooks are logged, not rethrown. */
	onStart?: (ctx: SolveContext) => void;
	onSettle?: (ctx: SolveContext, result: SolveResult) => void;
	onSuperseded?: (ctx: SolveContext) => void;
}

export interface SolveContext {
	/** Stable hash of (definition, dataTree). */
	key: string;
	/** Timestamp when scheduler.solve() was called. */
	enqueuedAt: number;
	/** Timestamp when execution actually started (after queueing). */
	startedAt: number | null;
}

export type SolveResult =
	| {
			status: 'success';
			response: GrasshopperComputeResponse;
			durationMs: number;
			fromCache: boolean;
			/**
			 * Definition-cache telemetry for a real compute call (not a Selva-cache
			 * `fromCache` hit). `false` → the server reused its cached definition via
			 * the pointer (no upload); `true` → the pointer was cold/stale so the full
			 * definition was re-uploaded. `undefined` when the server-definition-cache
			 * fast path didn't run (reuse disabled, or a non-reusable definition such
			 * as a remote URL).
			 */
			definitionReuploaded?: boolean;
	  }
	| { status: 'error'; error: RhinoComputeError; durationMs: number }
	| { status: 'superseded' };

export type SolveExecutor = (
	definition: SolveDefinition,
	dataTree: DataTree[],
	config: GrasshopperComputeConfig
) => Promise<GrasshopperComputeResponse>;

/**
 * Cache-key-aware executor. When `cacheKey` is provided, the executor solves by
 * reference (`pointer: cacheKey`) and falls back to a full upload on a server
 * cache miss. Always reports the (possibly refreshed) `cacheKey` so the
 * scheduler can update its definition→key map, plus whether the fast path
 * `missed` (for telemetry). When `cacheKey` is null it's a first solve — upload
 * fully and capture the key the server assigns.
 *
 * Supplied by the client (which owns the solve primitives); the scheduler stays
 * decoupled from the transport.
 */
export type CacheKeyExecutor = (
	definition: SolveDefinition,
	dataTree: DataTree[],
	cacheKey: string | null,
	config: GrasshopperComputeConfig
) => Promise<{ response: GrasshopperComputeResponse; cacheKey: string | null; missed: boolean }>;
