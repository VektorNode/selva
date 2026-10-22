import { ComputeError, ErrorCodes } from '@/core/errors';
import type { RetryPolicy } from '@/core/types';
import { getLogger } from '@/core/utils/logger';
import { readField } from '@/core/utils/read-field';
import { getResponseWireSize } from '@/core/compute-fetch/wire-size';

import type {
	DataTree,
	GrasshopperComputeResponse,
	GrasshopperComputeConfig,
	SelvaEventTarget
} from '../types';
import { isDefinitionUrl, type SolveDefinition } from '@/core/definition-ref';
import { hashSolveInputForDefinition, hashDefinition } from './stable-hash';

import type {
	SchedulerMode,
	SchedulerSolveOptions,
	SolveContext,
	SolveDetail,
	SolveExecutor,
	SolveResult,
	SolveSchedulerOptions
} from './types';

interface CacheEntry {
	response: GrasshopperComputeResponse;
	insertedAt: number;
	/** Wire size (or stringify-fallback estimate) counted against `maxBytes`. */
	sizeBytes: number;
}

const SERVER_CACHE_KEYS_MAX = 100;

interface PendingItem {
	definition: SolveDefinition;
	dataTree: DataTree[];
	definitionHash: string;
	ctx: SolveContext;
	/** Monotonic solve() ordinal, so an older item's late settle can't overwrite newer state. */
	seq: number;
	resolve: (detail: SolveDetail) => void;
	reject: (error: ComputeError) => void;
	externalSignal?: AbortSignal;
	selvaevents?: SelvaEventTarget;
	onServerTiming?: SchedulerSolveOptions['onServerTiming'];
	/** Settles the item as ABORTED if its signal fires while it waits in a queue. */
	queuedAbortHandler?: () => void;
	queueWaitTimer?: ReturnType<typeof setTimeout>;
	settled?: { error: ComputeError } | { ok: true };
}

interface InFlightItem extends PendingItem {
	controller: AbortController;
}

const u8DefinitionHashes = new WeakMap<Uint8Array, string>();

/**
 * Remembers a buffer's hash by identity: a buffer mutated after its first solve keeps its old
 * hash and is served the old content's cached solves.
 */
function hashDefinitionOnce(definition: SolveDefinition): string {
	if (!(definition instanceof Uint8Array)) return hashDefinition(definition);
	let hash = u8DefinitionHashes.get(definition);
	if (hash === undefined) {
		hash = hashDefinition(definition);
		u8DefinitionHashes.set(definition, hash);
	}
	return hash;
}

/**
 * For a response that never crossed the fetch boundary (custom executor), so carries no
 * wire-size hint. An unserializable response is sized 0 rather than failing the solve.
 */
function estimateResponseSize(response: GrasshopperComputeResponse): number {
	try {
		return JSON.stringify(response)?.length ?? 0;
	} catch {
		return 0;
	}
}

/**
 * Adds to a plain solve call:
 * - Scheduling (latest-wins for sliders, queue for jobs)
 * - Backpressure (bounded queue depth + queue-wait deadline)
 * - Cancellation (per-call signal + cancelAll)
 * - Optional response caching for repeated inputs
 * - Lifecycle hooks (start / settle / superseded) and state via subscribe()
 *
 * @example
 * ```ts
 * const scheduler = client.createScheduler({ mode: 'latest-wins', timeoutMs: 30_000 });
 *
 * // From a slider handler:
 * scheduler.solve(definition, tree).then((result) => {
 *   updateMeshes(result);
 * }).catch((err) => {
 *   if (err.code !== 'SUPERSEDED') showError(err);
 * });
 *
 * // From a UI binding:
 * scheduler.subscribe(() => {
 *   showSpinner = scheduler.isSolving;
 * });
 * ```
 */
export class SolveScheduler {
	private readonly executor: SolveExecutor;
	private readonly baseConfig: GrasshopperComputeConfig;

	private readonly mode: SchedulerMode;
	private maxConcurrent: number;
	private readonly maxQueueDepth: number | undefined;
	private readonly queueWaitMs: number | undefined;
	private readonly timeoutMs: number | undefined;
	private readonly retry: RetryPolicy | undefined;

	private readonly cacheEnabled: boolean;
	private readonly cacheMaxBytes: number;
	private readonly cacheTtl: number;
	private readonly cacheErroredSolves: boolean;
	private readonly cache = new Map<string, CacheEntry>();
	private cacheBytes = 0;
	private cacheHits = 0;
	private cacheMisses = 0;
	private cacheEvictions = 0;

	private readonly reuseServerDefinitionCache: boolean;
	/** Definition hash → the server's cache key (`pointer`) for it. */
	private readonly serverCacheKeys = new Map<string, string>();

	private readonly onStart?: SolveSchedulerOptions['onStart'];
	private readonly onSettle?: SolveSchedulerOptions['onSettle'];
	private readonly onSuperseded?: SolveSchedulerOptions['onSuperseded'];

	private readonly subscribers = new Set<() => void>();

	private readonly inFlight = new Set<InFlightItem>();
	private pendingForLatestWins: PendingItem | null = null;
	private readonly fifoQueue: PendingItem[] = [];

	private _lastResult: GrasshopperComputeResponse | null = null;
	private _lastError: ComputeError | null = null;
	private _lastDurationMs: number | null = null;

	private solveSeq = 0;
	/** seq of the solve that last wrote `_lastResult`/`_lastError`. */
	private lastStateSeq = 0;

	private disposed = false;

	constructor(
		executor: SolveExecutor,
		baseConfig: GrasshopperComputeConfig,
		options: SolveSchedulerOptions = {}
	) {
		this.executor = executor;
		this.baseConfig = baseConfig;
		this.mode = options.mode ?? 'latest-wins';
		if (this.mode !== 'latest-wins' && this.mode !== 'queue') {
			throw new ComputeError(
				`Unknown scheduler mode '${String(this.mode)}'. For concurrent solves use { mode: 'queue', maxConcurrent: 4 }.`,
				ErrorCodes.INVALID_CONFIG,
				{ context: { mode: this.mode } }
			);
		}
		this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 1);
		// A non-positive maxQueueDepth means unbounded, not "reject everything".
		this.maxQueueDepth =
			options.maxQueueDepth !== undefined && options.maxQueueDepth > 0
				? Math.floor(options.maxQueueDepth)
				: undefined;
		this.queueWaitMs =
			options.queueWaitMs !== undefined && options.queueWaitMs > 0
				? options.queueWaitMs
				: undefined;
		this.timeoutMs = options.timeoutMs;
		this.retry = options.retry;

		const cacheOpt = options.cache;
		const cacheConfig = typeof cacheOpt === 'object' ? cacheOpt : null;
		this.cacheMaxBytes = Math.max(0, cacheConfig?.maxBytes ?? 0);
		// A zero budget retains nothing, so treat it as off rather than running a
		// cache that can only ever miss.
		this.cacheEnabled = this.cacheMaxBytes > 0;
		this.cacheTtl = cacheConfig?.ttlMs ?? 0;
		this.cacheErroredSolves = cacheConfig?.cacheErroredSolves ?? true;

		this.reuseServerDefinitionCache = options.reuseServerDefinitionCache ?? true;

		this.onStart = options.onStart;
		this.onSettle = options.onSettle;
		this.onSuperseded = options.onSuperseded;
	}

	get isSolving(): boolean {
		return this.inFlight.size > 0;
	}

	get hasPending(): boolean {
		return this.pendingForLatestWins !== null || this.fifoQueue.length > 0;
	}

	get inFlightCount(): number {
		return this.inFlight.size;
	}

	get queueDepth(): number {
		return this.fifoQueue.length + (this.pendingForLatestWins ? 1 : 0);
	}

	get lastResult(): GrasshopperComputeResponse | null {
		return this._lastResult;
	}

	get lastError(): ComputeError | null {
		return this._lastError;
	}

	get lastDurationMs(): number | null {
		return this._lastDurationMs;
	}

	/**
	 * Adjust how many solves may run at once, for when the compute server's worker
	 * pool changes size after this scheduler was built.
	 *
	 * Raising it drains queued work immediately. Lowering it never interrupts work
	 * already in flight — those finish above the new limit, and the cap applies from
	 * the next dispatch. Values below 1 are clamped, since 0 would wedge the queue.
	 */
	setMaxConcurrent(value: number): void {
		const next = Math.max(1, Math.floor(value));
		if (next === this.maxConcurrent) return;
		const raised = next > this.maxConcurrent;
		this.maxConcurrent = next;
		if (raised) this.drainNext();
	}

	/** Current concurrency cap — reflects any {@link setMaxConcurrent} adjustment. */
	getMaxConcurrent(): number {
		return this.maxConcurrent;
	}

	/** Subscribe to state changes. */
	subscribe(listener: () => void): () => void {
		this.subscribers.add(listener);
		return () => this.subscribers.delete(listener);
	}

	private notify(): void {
		for (const listener of this.subscribers) {
			try {
				listener();
			} catch (err) {
				getLogger().error('[SolveScheduler] subscriber threw:', err);
			}
		}
	}

	/**
	 * Schedule a solve. Returns a promise that:
	 * - Resolves with the compute response on success.
	 * - Rejects with `ComputeError` on failure.
	 * - Rejects with `code: ErrorCodes.SUPERSEDED` when the call was canceled because
	 *   newer values arrived (latest-wins mode).
	 * - Rejects with `code: ErrorCodes.ABORTED` when the call was canceled via
	 *   its own `signal` (queued or running) or `cancelAll()`.
	 * - Rejects with `code: ErrorCodes.QUEUE_FULL` when `maxQueueDepth` is set and
	 *   the queue was already full (backpressure; `statusCode: 503`).
	 * - Rejects with `code: ErrorCodes.QUEUE_TIMEOUT` when `queueWaitMs` is set and
	 *   the call sat queued longer than that before starting (`statusCode: 503`).
	 *
	 * Don't mutate a `Uint8Array` definition after solving it. Responses served
	 * from the cache (and via `lastResult`) are shared objects, not copies —
	 * treat them as immutable. Mutating one poisons every later cache hit for
	 * that key.
	 *
	 * Partial-success contract: unlike `GrasshopperClient.solve()`, which throws
	 * `COMPUTATION_ERROR` when the response carries solver errors, this RESOLVES
	 * with the response as-is — check `response.errors` yourself if a partial
	 * success must not be treated as a result (see `cacheErroredSolves` for the
	 * caching side of the same distinction).
	 */
	solve(
		definition: SolveDefinition,
		dataTree: DataTree[],
		options?: SchedulerSolveOptions
	): Promise<GrasshopperComputeResponse> {
		return this.solveDetailed(definition, dataTree, options).then((detail) => detail.response);
	}

	/** {@link solve}, also resolving with whether this call hit the cache and how long it took. */
	solveDetailed(
		definition: SolveDefinition,
		dataTree: DataTree[],
		options?: SchedulerSolveOptions
	): Promise<SolveDetail> {
		if (this.disposed) {
			return Promise.reject(
				new ComputeError(
					'SolveScheduler has been disposed and cannot be used',
					ErrorCodes.INVALID_STATE
				)
			);
		}

		const definitionHash = hashDefinitionOnce(definition);
		const key = hashSolveInputForDefinition(definitionHash, dataTree);
		const seq = ++this.solveSeq;
		const ctx: SolveContext = {
			key,
			enqueuedAt: Date.now(),
			startedAt: null
		};

		// An already-aborted signal rejects before anything else — including the
		// cache: the documented contract is ABORTED, not a result.
		if (options?.signal?.aborted) {
			return Promise.reject(this.makeAbortError(ctx));
		}

		const cached = this.readCache(key);
		if (cached) {
			// In latest-wins an older in-flight solve is now stale: left running, its
			// completion would overwrite this hit and snap the UI back.
			if (this.mode === 'latest-wins') {
				this.supersedeCurrent();
			}
			const result: SolveResult = {
				status: 'success',
				response: cached,
				durationMs: 0,
				fromCache: true
			};
			this.writeLastState(seq, { result: cached, durationMs: 0 });
			this.runHook(this.onStart, ctx);
			this.runHook(this.onSettle, ctx, result);
			this.notify();
			return Promise.resolve({ response: cached, fromCache: true, durationMs: 0 });
		}

		return new Promise<SolveDetail>((resolve, reject) => {
			const item: PendingItem = {
				definition,
				dataTree,
				definitionHash,
				ctx,
				seq,
				resolve,
				reject,
				externalSignal: options?.signal,
				selvaevents: options?.selvaevents,
				onServerTiming: options?.onServerTiming
			};

			if (item.externalSignal) {
				item.queuedAbortHandler = () => this.abortQueuedItem(item);
				item.externalSignal.addEventListener('abort', item.queuedAbortHandler, { once: true });
			}

			this.enqueue(item);
		});
	}

	/** A slow solve settling late must not overwrite state a newer solve or cache hit published. */
	private writeLastState(
		seq: number,
		state:
			| { result: GrasshopperComputeResponse; durationMs: number }
			| { error: ComputeError; durationMs: number }
	): void {
		if (seq < this.lastStateSeq) return;
		this.lastStateSeq = seq;
		if ('result' in state) {
			this._lastResult = state.result;
			this._lastError = null;
		} else {
			this._lastError = state.error;
		}
		this._lastDurationMs = state.durationMs;
	}

	/** latest-wins: supersede the pending item and abort everything in flight. */
	private supersedeCurrent(): void {
		if (this.pendingForLatestWins) {
			this.supersede(this.pendingForLatestWins);
			this.pendingForLatestWins = null;
		}
		for (const inflight of this.inFlight) {
			this.supersede(inflight);
			inflight.controller.abort();
		}
	}

	private dequeue(item: PendingItem): void {
		if (this.pendingForLatestWins === item) this.pendingForLatestWins = null;
		const queued = this.fifoQueue.indexOf(item);
		if (queued >= 0) this.fifoQueue.splice(queued, 1);
	}

	private abortQueuedItem(item: PendingItem): void {
		this.dequeue(item);
		this.fail(item, this.makeAbortError(item.ctx));
		this.notify();
	}

	/** The structured context lets an HTTP layer map QUEUE_FULL to 503 + Retry-After. */
	private shedAsQueueFull(item: PendingItem): void {
		const err = new ComputeError(
			'Solve queue is full; request rejected (backpressure)',
			ErrorCodes.QUEUE_FULL,
			{
				statusCode: 503,
				context: {
					key: item.ctx.key,
					queueDepth: this.fifoQueue.length,
					maxQueueDepth: this.maxQueueDepth
				}
			}
		);
		this.fail(item, err);
		this.notify();
	}

	private armQueueWaitTimer(item: PendingItem): void {
		if (this.queueWaitMs === undefined) return;
		const waitMs = this.queueWaitMs;
		item.queueWaitTimer = setTimeout(() => {
			if (item.settled) return;
			this.dequeue(item);

			const err = new ComputeError(
				`Solve waited longer than ${waitMs}ms in queue; rejected (backpressure)`,
				ErrorCodes.QUEUE_TIMEOUT,
				{
					statusCode: 503,
					context: {
						key: item.ctx.key,
						waitedMs: Date.now() - item.ctx.enqueuedAt,
						queueWaitMs: waitMs
					}
				}
			);
			this.fail(item, err);
			this.notify();
		}, waitMs);
	}

	private clearQueueWaitTimer(item: PendingItem): void {
		if (item.queueWaitTimer !== undefined) {
			clearTimeout(item.queueWaitTimer);
			item.queueWaitTimer = undefined;
		}
	}

	private enqueue(item: PendingItem): void {
		switch (this.mode) {
			case 'latest-wins': {
				this.supersedeCurrent();
				if (this.inFlight.size === 0) {
					this.execute(item);
				} else {
					this.pendingForLatestWins = item;
				}
				break;
			}

			case 'queue': {
				if (this.inFlight.size < this.maxConcurrent) {
					this.execute(item);
				} else if (
					this.maxQueueDepth !== undefined &&
					this.fifoQueue.length >= this.maxQueueDepth
				) {
					// Shed the newest call, so already-accepted work keeps its place.
					this.shedAsQueueFull(item);
				} else {
					this.armQueueWaitTimer(item);
					this.fifoQueue.push(item);
				}
				break;
			}
		}
		this.notify();
	}

	private async execute(item: PendingItem): Promise<void> {
		const controller = new AbortController();
		// Mutate, don't copy: every settle path must share the one `settled` slot.
		const inflight = item as InFlightItem;
		inflight.controller = controller;
		this.inFlight.add(inflight);
		item.ctx.startedAt = Date.now();

		this.clearQueueWaitTimer(item);
		this.removeQueuedAbortHandler(item);
		const externalAbortHandler = () => controller.abort();
		item.externalSignal?.addEventListener('abort', externalAbortHandler, { once: true });

		this.runHook(this.onStart, item.ctx);
		this.notify();

		const startTime = performance.now();
		try {
			const config: GrasshopperComputeConfig = {
				...this.baseConfig,
				signal: controller.signal,
				...(this.timeoutMs !== undefined && { timeoutMs: this.timeoutMs }),
				...(this.retry !== undefined && { retry: this.retry }),
				...(item.selvaevents !== undefined && { selvaevents: item.selvaevents })
			};
			const callTiming = item.onServerTiming;
			if (callTiming) {
				const baseTiming = this.baseConfig.onServerTiming;
				config.onServerTiming = (timing, requestId) => {
					try {
						baseTiming?.(timing, requestId);
					} finally {
						callTiming(timing, requestId);
					}
				};
			}

			const { response, definitionReuploaded } = await this.runExecutor(
				item.definition,
				item.dataTree,
				item.definitionHash,
				config
			);
			const durationMs = performance.now() - startTime;

			this.writeCache(item.ctx.key, response);

			if (
				!this.settleSuccess(item, { response, fromCache: false, definitionReuploaded, durationMs })
			) {
				return;
			}

			this.writeLastState(item.seq, { result: response, durationMs });

			this.runHook(this.onSettle, item.ctx, {
				status: 'success',
				response,
				durationMs,
				fromCache: false,
				definitionReuploaded
			});
		} catch (error) {
			const durationMs = performance.now() - startTime;
			const err = this.normalizeExecutionError(error, inflight);
			this.writeLastState(item.seq, { error: err, durationMs });
			this.fail(item, err, durationMs);
		} finally {
			item.externalSignal?.removeEventListener('abort', externalAbortHandler);
			this.inFlight.delete(inflight);
			this.drainNext();
			this.notify();
		}
	}

	private async runExecutor(
		definition: SolveDefinition,
		dataTree: DataTree[],
		definitionHash: string,
		config: GrasshopperComputeConfig
	): Promise<{ response: GrasshopperComputeResponse; definitionReuploaded?: boolean }> {
		if (!this.reuseServerDefinitionCache || isDefinitionUrl(definition)) {
			const { response } = await this.executor(definition, dataTree, null, config);
			return { response };
		}

		const knownKey = this.serverCacheKeys.get(definitionHash) ?? null;
		const result = await this.executor(definition, dataTree, knownKey, config);

		// Delete before set so a hit moves to the back of the eviction order.
		this.serverCacheKeys.delete(definitionHash);
		if (result.cacheKey) {
			this.serverCacheKeys.set(definitionHash, result.cacheKey);
			if (this.serverCacheKeys.size > SERVER_CACHE_KEYS_MAX) {
				this.serverCacheKeys.delete(this.serverCacheKeys.keys().next().value!);
			}
		}

		return { response: result.response, definitionReuploaded: result.missed };
	}

	private drainNext(): void {
		if (this.disposed) return;

		if (this.mode === 'latest-wins') {
			if (this.pendingForLatestWins && this.inFlight.size === 0) {
				const next = this.pendingForLatestWins;
				this.pendingForLatestWins = null;
				this.execute(next);
			}
			return;
		}

		while (this.fifoQueue.length > 0 && this.inFlight.size < this.maxConcurrent) {
			const next = this.fifoQueue.shift()!;
			this.execute(next);
		}
	}

	private supersede(item: PendingItem): void {
		const err = new ComputeError('Superseded by newer solve', ErrorCodes.SUPERSEDED, {
			context: { key: item.ctx.key, enqueuedAt: item.ctx.enqueuedAt }
		});
		if (this.settleError(item, err)) {
			this.runHook(this.onSuperseded, item.ctx);
		}
	}

	private makeAbortError(ctx: SolveContext): ComputeError {
		return new ComputeError('Request aborted by caller', ErrorCodes.ABORTED, {
			context: { key: ctx.key, enqueuedAt: ctx.enqueuedAt }
		});
	}

	/**
	 * The executor, `supersede`, `cancelAll`, abort and the queue limits can all race to settle one
	 * item, and a promise ignores a second settle silently. The first settle wins; the return value
	 * says whether this call won, so only the winner fires its hook. Every settle path goes through
	 * here or {@link settleSuccess}.
	 */
	private settleError(item: PendingItem, err: ComputeError): boolean {
		if (item.settled) return false;
		item.settled = { error: err };
		this.clearQueueWaitTimer(item);
		this.removeQueuedAbortHandler(item);
		item.reject(err);
		return true;
	}

	/**
	 * Fires `onSettle` for queued items too, so a consumer counting solves in progress doesn't
	 * leak one. A supersede settles through {@link settleError} and fires `onSuperseded` instead.
	 */
	private fail(item: PendingItem, err: ComputeError, durationMs = 0): void {
		if (this.settleError(item, err)) {
			this.runHook(this.onSettle, item.ctx, { status: 'error', error: err, durationMs });
		}
	}

	private settleSuccess(item: PendingItem, detail: SolveDetail): boolean {
		if (item.settled) return false;
		item.settled = { ok: true };
		this.clearQueueWaitTimer(item);
		this.removeQueuedAbortHandler(item);
		item.resolve(detail);
		return true;
	}

	private removeQueuedAbortHandler(item: PendingItem): void {
		if (item.queuedAbortHandler && item.externalSignal) {
			item.externalSignal.removeEventListener('abort', item.queuedAbortHandler);
		}
		item.queuedAbortHandler = undefined;
	}

	private normalizeExecutionError(error: unknown, item: InFlightItem): ComputeError {
		// Already settled (superseded, cancelled): keep the original cause, not the abort it caused.
		if (item.settled && 'error' in item.settled) {
			return item.settled.error;
		}

		if (error instanceof ComputeError) return error;

		// Not `isAbortError`: a raw `TimeoutError` is a timeout, and must not read as a caller abort.
		if (error instanceof Error && error.name === 'AbortError') {
			return this.makeAbortError(item.ctx);
		}

		return new ComputeError(
			error instanceof Error ? error.message : String(error),
			ErrorCodes.UNKNOWN_ERROR,
			{ originalError: error }
		);
	}

	// ============================================================================
	// Cancellation
	// ============================================================================

	/** Cancel everything — in-flight and pending. */
	cancelAll(): void {
		if (this.pendingForLatestWins) {
			this.fail(this.pendingForLatestWins, this.makeAbortError(this.pendingForLatestWins.ctx));
			this.pendingForLatestWins = null;
		}
		while (this.fifoQueue.length > 0) {
			const item = this.fifoQueue.shift()!;
			this.fail(item, this.makeAbortError(item.ctx));
		}
		for (const inflight of this.inFlight) {
			// startedAt is a Date.now() timestamp, so measure with the same clock.
			const durationMs = inflight.ctx.startedAt ? Date.now() - inflight.ctx.startedAt : 0;
			this.fail(inflight, this.makeAbortError(inflight.ctx), durationMs);
			inflight.controller.abort();
		}
		this.notify();
	}

	// ============================================================================
	// Cache
	// ============================================================================

	private readCache(key: string): GrasshopperComputeResponse | null {
		if (!this.cacheEnabled) return null;
		const entry = this.cache.get(key);
		if (!entry) {
			this.cacheMisses += 1;
			return null;
		}
		if (this.cacheTtl > 0 && Date.now() - entry.insertedAt > this.cacheTtl) {
			this.dropCacheEntry(key);
			this.cacheMisses += 1;
			return null;
		}
		// LRU touch
		this.cache.delete(key);
		this.cache.set(key, entry);
		this.cacheHits += 1;
		return entry.response;
	}

	private writeCache(key: string, response: GrasshopperComputeResponse): void {
		if (!this.cacheEnabled) return;
		const solveErrors = readField<unknown[]>(response, 'errors');
		if (!this.cacheErroredSolves && Array.isArray(solveErrors) && solveErrors.length > 0) return;
		const sizeBytes = getResponseWireSize(response) ?? estimateResponseSize(response);
		// Retaining it would evict everything else and then itself.
		if (sizeBytes > this.cacheMaxBytes) return;
		this.dropCacheEntry(key); // replace-in-place: release the old copy's bytes
		this.cache.set(key, { response, insertedAt: Date.now(), sizeBytes });
		this.cacheBytes += sizeBytes;
		while (this.cacheBytes > this.cacheMaxBytes && this.cache.size > 0) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) break;
			this.dropCacheEntry(oldest);
			this.cacheEvictions += 1;
		}
	}

	private dropCacheEntry(key: string): void {
		const entry = this.cache.get(key);
		if (!entry) return;
		this.cache.delete(key);
		this.cacheBytes -= entry.sizeBytes;
	}

	clearCache(): void {
		this.cache.clear();
		this.cacheBytes = 0;
	}

	/**
	 * Observability snapshot of the solve cache: current size plus lifetime
	 * hit/miss/eviction counters.
	 *
	 * `hits`/`misses` count cache CONSULTATIONS, so `hits / (hits + misses)` is the
	 * hit rate. A TTL-expired entry counts as a miss (the solve runs either way).
	 * `evictions` counts only entries dropped under size/byte pressure — not
	 * replace-in-place writes or TTL expiry, which are not capacity signals.
	 * Counters are cumulative and survive `clearCache()`.
	 */
	cacheStats(): {
		entries: number;
		bytes: number;
		hits: number;
		misses: number;
		evictions: number;
	} {
		return {
			entries: this.cache.size,
			bytes: this.cacheBytes,
			hits: this.cacheHits,
			misses: this.cacheMisses,
			evictions: this.cacheEvictions
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelAll();
		this.subscribers.clear();
		this.clearCache();
	}

	private runHook<H extends (...args: never[]) => void>(
		hook: H | undefined,
		...args: Parameters<H>
	): void {
		if (!hook) return;
		try {
			hook(...args);
		} catch (err) {
			getLogger().error('[SolveScheduler] hook threw:', err);
		}
	}
}
