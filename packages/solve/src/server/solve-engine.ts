/**
 * Facade over the warm-client cache, definition-byte cache, single-flight
 * coalescing, and the solve pipeline — the primitives an app route would
 * otherwise wire up by hand.
 *
 * Doesn't read env itself: `@selvajs/server` owns `resolveComputeLimits` and
 * depends on `@selvajs/solve`, so calling it from here would be a circular
 * import. Callers resolve their own limits and pass in the fields below.
 *
 * Stays out of auth, DB reads, share tokens, rate limiting, metrics, and
 * compute-server selection — all app policy, supplied per-call via
 * `SolveEngineSolveArgs.server`.
 */

import {
	isDefinitionRef,
	stableStringify,
	type DefinitionRef,
	type SolveDefinition
} from '@selvajs/compute';
import { NoopLogger, type ILogger } from '@selvajs/platform';
import {
	createClientCache,
	type CachedClient,
	type ClientCache,
	type ClientCacheDebug,
	type ResolvedServer,
	type SolveCacheStats
} from './client-cache.js';
import {
	createDefinitionByteCache,
	type ByteCacheRef,
	type ByteCacheStats,
	type DefinitionByteCache
} from './definition-byte-cache.js';
import {
	createSolveCacheSingleFlight,
	type SolveCacheSingleFlight
} from './solve-cache-single-flight.js';
import {
	adaptEnvelopeToEncoding,
	buildSolveInputTree,
	runSolvePipeline,
	type PipelineInput,
	type SolveOutcome
} from './solve-pipeline.js';

/**
 * Subset of `ComputeLimits` (`@selvajs/server/compute`) the engine needs.
 * Pass the resolved object through as-is — extra fields are ignored.
 */
export interface SolveEngineLimits {
	solveDeadlineMs: number;
	computeResponseMaxBytes: number;
	computeReuseDefinitionCache: boolean;
	computeServerCachesolve: boolean;
	computeCacheErroredSolves: boolean;
	computeMaxQueueDepth: number;
	computeQueueWaitMs: number;
	computeDefinitionCacheBytes: number;
	computeSolveCacheBytes: number;
}

export interface SolveEngineOptions {
	limits: SolveEngineLimits;
	logger?: ILogger;
	/** Max distinct warm compute servers before the LRU evicts the oldest. Default 16. */
	maxWarmComputeServers?: number;
	/** Concise cache/timing logs when truthy; `'verbose'` also dumps full lib-level requests/responses. Default off. */
	debug?: ClientCacheDebug;
	onDebugLog?: (message: string) => void;
	/** Fired when a caller joins an already-in-flight solve instead of running its own. */
	onSolveCoalesced?: (key: string) => void;
}

/**
 * Accepts every form `runSolvePipeline` does, plus `{versionId, load}` sugar
 * that builds (and caches) a `ByteCacheRef` internally. A `ByteCacheRef`
 * obtained ahead of time from `engine.definitionRef()` (e.g. to read bytes for
 * schema extraction before solving) is passed through as-is — detected by its
 * `outcome` field, which a plain `DefinitionRef` never has.
 */
export type SolveEngineDefinitionSource =
	| Uint8Array
	| string
	| DefinitionRef
	| ByteCacheRef
	| { versionId: string; load: () => Promise<Uint8Array> };

export interface SolveEngineSolveArgs {
	server: ResolvedServer;
	definitionSource: SolveEngineDefinitionSource;
	/**
	 * Coalesce-key identity for a raw `Uint8Array`/`string` source, which has
	 * no natural identity the way a `DefinitionRef`'s `.key` does. Required in
	 * that case — `solve()` throws rather than silently hashing the bytes.
	 * Ignored for the other source forms.
	 */
	definitionKey?: string;
	inputs: PipelineInput[];
	values: Record<string, unknown>;
	signal: AbortSignal;
	acceptEncoding?: string;
	/** Stamped as `X-Selva-Definition` on this solve's client. */
	definitionGuid?: string;
	loadStartMs?: number;
	defLoadMs?: number;
	prepMarks?: [string, number][];
}

export interface FrameworkAgnosticResponse {
	status: number;
	headers: Record<string, string>;
	body: string | Uint8Array;
}

export interface SolveEngineStats {
	client: SolveCacheStats;
	definitionBytes: ByteCacheStats;
	coalescing: { inFlight: number };
}

function isByteCacheRef(source: SolveEngineDefinitionSource): source is ByteCacheRef {
	return (
		typeof source === 'object' &&
		source !== null &&
		!(source instanceof Uint8Array) &&
		'outcome' in source
	);
}

function isVersionLoadPair(
	source: SolveEngineDefinitionSource
): source is { versionId: string; load: () => Promise<Uint8Array> } {
	return (
		typeof source === 'object' &&
		source !== null &&
		!(source instanceof Uint8Array) &&
		!('outcome' in source) &&
		!('key' in source) &&
		'versionId' in source
	);
}

export class SolveEngine {
	private readonly limits: SolveEngineLimits;
	private readonly clientCache: ClientCache;
	private readonly byteCache: DefinitionByteCache;
	private readonly singleFlight: SolveCacheSingleFlight;

	constructor(options: SolveEngineOptions) {
		this.limits = options.limits;
		const logger = options.logger ?? new NoopLogger();

		this.clientCache = createClientCache({
			solveDeadlineMs: this.limits.solveDeadlineMs,
			cachesolve: this.limits.computeServerCachesolve,
			cacheerroredsolves: this.limits.computeCacheErroredSolves,
			reuseServerDefinitionCache: this.limits.computeReuseDefinitionCache,
			maxQueueDepth: this.limits.computeMaxQueueDepth,
			queueWaitMs: this.limits.computeQueueWaitMs,
			responseCacheMaxBytes: this.limits.computeSolveCacheBytes,
			debug: options.debug ?? false,
			maxWarmComputeServers: options.maxWarmComputeServers,
			onDebugLog:
				options.onDebugLog ??
				((message) => logger.debug(message, { component: 'Compute/client-cache' }))
		});

		this.byteCache = createDefinitionByteCache(this.limits.computeDefinitionCacheBytes);

		this.singleFlight = createSolveCacheSingleFlight({
			onJoin: options.onSolveCoalesced
		});
	}

	getClient(server: ResolvedServer, opts?: { definitionGuid?: string }): Promise<CachedClient> {
		return this.clientCache.getClient(server, opts);
	}

	definitionRef(versionId: string, load: () => Promise<Uint8Array>): ByteCacheRef {
		return this.byteCache.getOrLoad(versionId, load);
	}

	evictServer(id: string): void {
		this.clientCache.evict(id);
	}

	clearSolveCaches(): void {
		this.clientCache.clearSolveCaches();
	}

	stats(): SolveEngineStats {
		return {
			client: this.clientCache.solveCacheStats(),
			definitionBytes: this.byteCache.stats(),
			coalescing: { inFlight: this.singleFlight.inFlight() }
		};
	}

	async solve(args: SolveEngineSolveArgs): Promise<SolveOutcome> {
		const {
			definitionSource: resolvedSource,
			byteRefOutcome,
			identity
		} = this.resolveDefinitionSource(args);

		const client = await this.clientCache.getClient(args.server, {
			definitionGuid: args.definitionGuid
		});
		const inputTree = buildSolveInputTree(args.inputs, args.values);
		const coalesceKey = `${identity}:${args.server.id}:${stableStringify(inputTree)}`;

		// A coalesced solve is shared, so one caller's disconnect can't 499 every
		// other waiter. Only propagate abort if no one else has joined yet.
		const abortController = new AbortController();
		let hasWaiters = false;
		const onCallerAbort = () => {
			if (!hasWaiters) abortController.abort();
		};
		// `once: true` doesn't detach on a normal completion, and the caller's signal
		// outlives this call — a request signal fires `abort` after the response is
		// consumed, and a session-scoped one never settles at all. Without the
		// `finally` below, every solve leaks a listener onto it.
		args.signal.addEventListener('abort', onCallerAbort, { once: true });

		const acceptEncoding = args.acceptEncoding ?? '';
		let outcome: SolveOutcome;
		try {
			outcome = await this.singleFlight.run(
				coalesceKey,
				() =>
					runSolvePipeline({
						definitionSource: resolvedSource,
						byteRefOutcome,
						inputs: args.inputs,
						values: args.values,
						inputTree,
						client,
						responseMaxBytes: this.limits.computeResponseMaxBytes,
						solveDeadlineMs: this.limits.solveDeadlineMs,
						acceptEncoding,
						signal: abortController.signal,
						loadStartMs: args.loadStartMs ?? performance.now(),
						defLoadMs: args.defLoadMs ?? 0,
						prepMarks: args.prepMarks
					}),
				() => {
					hasWaiters = true;
				}
			);
		} finally {
			args.signal.removeEventListener('abort', onCallerAbort);
		}

		if (outcome.kind !== 'ok') return outcome;

		// The envelope may be shared across waiters; re-key it to this caller's
		// own Accept-Encoding so each one gets the right wire form.
		const wire = adaptEnvelopeToEncoding(outcome.envelope, acceptEncoding);
		return {
			...outcome,
			envelope: { ...outcome.envelope, body: wire.body, headers: wire.headers }
		};
	}

	toResponse(
		outcome: SolveOutcome,
		opts?: { onError?: (status: number, body: { message: string; retryAfter?: number }) => never }
	): FrameworkAgnosticResponse {
		const fail = (
			status: number,
			body: { message: string; retryAfter?: number }
		): FrameworkAgnosticResponse => {
			if (opts?.onError) opts.onError(status, body);
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (body.retryAfter !== undefined) headers['Retry-After'] = String(body.retryAfter);
			return { status, headers, body: JSON.stringify(body) };
		};

		switch (outcome.kind) {
			case 'ok':
				return { status: 200, headers: outcome.envelope.headers, body: outcome.envelope.body };
			case 'timeout':
				return fail(504, { message: outcome.message });
			case 'client_abort':
				return fail(499, { message: 'Client closed request' });
			case 'too_large':
				return fail(413, {
					message:
						'Solve result is too large to return. This usually means a file output exceeds the supported size.'
				});
			case 'shed':
				return fail(503, { message: outcome.message, retryAfter: outcome.retryAfterSeconds });
			case 'compute_error':
				throw outcome.error;
		}
	}

	toWebResponse(outcome: SolveOutcome): Response {
		const r = this.toResponse(outcome);
		return new Response(typeof r.body === 'string' ? r.body : new Uint8Array(r.body), {
			status: r.status,
			headers: r.headers
		});
	}

	private resolveDefinitionSource(args: SolveEngineSolveArgs): {
		definitionSource: SolveDefinition;
		byteRefOutcome?: ByteCacheRef['outcome'];
		identity: string;
	} {
		const source = args.definitionSource;

		if (isVersionLoadPair(source)) {
			const ref = this.byteCache.getOrLoad(source.versionId, source.load);
			return { definitionSource: ref, byteRefOutcome: ref.outcome, identity: ref.key };
		}

		if (isByteCacheRef(source)) {
			return { definitionSource: source, byteRefOutcome: source.outcome, identity: source.key };
		}

		if (isDefinitionRef(source)) {
			return { definitionSource: source, identity: source.key };
		}

		// Raw Uint8Array | string — no natural identity; require the caller's own.
		if (!args.definitionKey) {
			throw new Error(
				'SolveEngine.solve(): definitionKey is required when definitionSource is raw bytes or a string.'
			);
		}
		return { definitionSource: source, identity: args.definitionKey };
	}
}
