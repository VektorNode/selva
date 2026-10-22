import type { ComputeError } from '@/core/errors';
import type { RetryPolicy } from '@/core/types';

import type { DataTree, GrasshopperComputeResponse, GrasshopperComputeConfig } from '../types';
import type { SolveDefinition } from '@/core/definition-ref';

/**
 * How concurrent `solve()` calls interact.
 *
 * - `latest-wins`: one in flight at a time. A new call supersedes the pending
 *   one and aborts the one in flight. For slider scrubs and live UIs.
 * - `queue`: FIFO, every call runs to completion, up to `maxConcurrent` at
 *   once (default 1). For "submit job" flows where every request matters.
 * - `parallel`: the same FIFO queue with `maxConcurrent` defaulting to 4.
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
	 * `solve()` is rejected immediately with `code: QUEUE_FULL` (retryable, meant to
	 * map to HTTP 503 + Retry-After) instead of piling up unbounded. Bounds the
	 * miss path under load. Only applies to `queue` / `parallel` modes —
	 * `latest-wins` has an intrinsic depth of 1. Default: unbounded.
	 */
	maxQueueDepth?: number;
	/**
	 * Backpressure — max time (ms) a call may sit queued before it starts
	 * executing. If it's still waiting after this long it's rejected with
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
	 * Upload a definition once, then solve it by the server's cache key (`pointer`)
	 * instead of re-sending the bytes; a `DefinitionRef` also skips its `load()`.
	 * When the server has evicted the key, the solve falls back to a full upload,
	 * so this is safe to leave on. No effect for URL definitions, which are
	 * already a reference. Needs a `cacheKeyExecutor` (the client wires one);
	 * default `true` when one is present.
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
			 * Whether this solve uploaded the full definition: `true` on its first
			 * solve or after the server evicted the cache key, `false` when the server
			 * reused its cached copy via the pointer. `undefined` for a `fromCache`
			 * hit, or when reuse is off or the definition is a URL.
			 */
			definitionReuploaded?: boolean;
	  }
	| { status: 'error'; error: ComputeError; durationMs: number }
	| { status: 'superseded' };

export type SolveExecutor = (
	definition: SolveDefinition,
	dataTree: DataTree[],
	config: GrasshopperComputeConfig
) => Promise<GrasshopperComputeResponse>;

/**
 * Solves by `cacheKey` when given one, otherwise uploads. Reports the server's
 * (possibly new) key and whether the full definition was uploaded (`missed`).
 */
export type CacheKeyExecutor = (
	definition: SolveDefinition,
	dataTree: DataTree[],
	cacheKey: string | null,
	config: GrasshopperComputeConfig
) => Promise<{ response: GrasshopperComputeResponse; cacheKey: string | null; missed: boolean }>;
