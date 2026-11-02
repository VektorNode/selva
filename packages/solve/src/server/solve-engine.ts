/**
 * Facade over the warm-client cache, definition-byte cache, single-flight
 * coalescing, and the solve pipeline — the primitives an app route would
 * otherwise wire up by hand.
 *
 * Doesn't read env itself: `@selvajs/server` owns `resolveComputeLimits`, and
 * this package stays independent of it. Callers resolve their own limits and
 * pass in the fields below.
 *
 * Stays out of auth, DB reads, share tokens, rate limiting, metrics, and
 * compute-server selection — all app policy, supplied per-call via
 * `SolveEngineSolveArgs.server`.
 */

import {
	ComputeError,
	ErrorCodes,
	isDefinitionRef,
	type DefinitionRef,
	type SolveDefinition
} from '@selvajs/compute/core';
import { stableStringify, type SelvaEventTarget } from '@selvajs/compute/grasshopper';
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
	isByteCacheRef,
	type ByteCacheRef,
	type ByteCacheStats,
	type DefinitionByteCache
} from './definition-byte-cache.js';
import { buildEnvelope } from './response-encoding.js';
import { buildServerTiming, type PrepMark } from './server-timing.js';
import {
	createSolveCacheSingleFlight,
	type SolveCacheSingleFlight
} from './solve-cache-single-flight.js';
import { buildSolveInputTree } from './transform-input.js';
import { interrupted, runSolvePipeline, type SolveEngineOutcome } from './solve-pipeline.js';
import type { SolveInput } from '../shared/solve-input.js';

/**
 * Subset of `ComputeLimits` (`@selvajs/server/compute`) the engine needs.
 * Pass the resolved object through as-is — extra fields are ignored.
 */
export interface SolveEngineLimits {
	solveDeadlineMs: number;
	computeResponseMaxBytes: number;
	computeReuseDefinitionCache: boolean;
	computeServerCachesolve: boolean;
	computeMaxQueueDepth: number;
	computeQueueWaitMs: number;
	computeDefinitionCacheBytes: number;
	computeSolveCacheBytes: number;
}

/** A deadline of 0 means no deadline, and a `NaN` budget retains without limit, both silently. */
function assertValidLimits(limits: SolveEngineLimits): void {
	const check = (name: keyof SolveEngineLimits, min: number) => {
		const value = limits[name] as number;
		if (!Number.isFinite(value) || value < min) {
			throw new RangeError(`SolveEngine: limits.${name} must be a number >= ${min}, got ${value}.`);
		}
	};
	check('solveDeadlineMs', 1);
	check('computeResponseMaxBytes', 1);
	check('computeMaxQueueDepth', 0);
	check('computeQueueWaitMs', 0);
	check('computeDefinitionCacheBytes', 0);
	check('computeSolveCacheBytes', 0);
}

export interface SolveEngineOptions {
	limits: SolveEngineLimits;
	/** Max distinct warm compute servers before the LRU evicts the oldest. */
	maxWarmComputeServers?: number;
	/** Concise cache/timing logs when truthy; `'verbose'` also dumps full lib-level requests/responses. Default off. */
	debug?: ClientCacheDebug;
	/** Sink for the debug lines. Without it they go nowhere. */
	onDebugLog?: (message: string) => void;
	/** Fired when a caller joins an already-in-flight solve instead of running its own. */
	onSolveCoalesced?: (key: string) => void;
}

/**
 * A `ByteCacheRef` obtained ahead of time from `engine.definitionRef()` (e.g. to
 * read bytes for schema extraction before solving) is passed through as-is.
 */
export type SolveEngineDefinitionSource = Uint8Array | string | DefinitionRef | ByteCacheRef;

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
	/**
	 * The definition's inputs, from the schema you stored, never from the request: `id`, `nickname`,
	 * `paramType` and the bounds decide what reaches the definition, so a body that supplies them
	 * can drop a limit or fill a slot your host reserved.
	 */
	inputs: SolveInput[];
	values: Record<string, unknown>;
	signal: AbortSignal;
	acceptEncoding?: string;
	/**
	 * Stamped as `X-Selva-Definition` when this solve builds the server's warm client. The header
	 * is fixed per client, so later solves on that server carry the first definition's guid.
	 */
	definitionGuid?: string;
	loadStartMs?: number;
	defLoadMs?: number;
	prepMarks?: PrepMark[];
	/**
	 * Per-solve live-event callback. A coalesced waiter shares the first caller's
	 * compute call, so only that caller's target reaches the definition; the
	 * others still get the server-emitted start/end events on their own stream.
	 */
	selvaEvents?: SelvaEventTarget;
}

export interface SolveEngineStats {
	client: SolveCacheStats;
	definitionBytes: ByteCacheStats;
	coalescing: { inFlight: number };
}

export class SolveEngine {
	private readonly limits: SolveEngineLimits;
	private readonly clientCache: ClientCache;
	private readonly byteCache: DefinitionByteCache;
	private readonly singleFlight: SolveCacheSingleFlight;
	private readonly clientGenerations = new WeakMap<CachedClient, number>();
	private lastClientGeneration = 0;

	constructor(options: SolveEngineOptions) {
		assertValidLimits(options.limits);
		this.limits = options.limits;

		this.clientCache = createClientCache({
			solveDeadlineMs: this.limits.solveDeadlineMs,
			cachesolve: this.limits.computeServerCachesolve,
			reuseServerDefinitionCache: this.limits.computeReuseDefinitionCache,
			maxQueueDepth: this.limits.computeMaxQueueDepth,
			queueWaitMs: this.limits.computeQueueWaitMs,
			responseCacheMaxBytes: this.limits.computeSolveCacheBytes,
			maxResponseBytes: this.limits.computeResponseMaxBytes,
			debug: options.debug ?? false,
			maxWarmComputeServers: options.maxWarmComputeServers,
			onDebugLog: options.onDebugLog
		});

		this.byteCache = createDefinitionByteCache(this.limits.computeDefinitionCacheBytes);

		this.singleFlight = createSolveCacheSingleFlight({
			onJoin: options.onSolveCoalesced
		});
	}

	getClient(server: ResolvedServer, opts?: { definitionGuid?: string }): Promise<CachedClient> {
		return this.clientCache.getClient(server, opts);
	}

	definitionRef(
		versionId: string,
		load: (signal: AbortSignal) => Promise<Uint8Array>
	): ByteCacheRef {
		return this.byteCache.getOrLoad(versionId, load);
	}

	/**
	 * Drops the warm client for `id`; call it when the server's URL or key changes. Solves already
	 * running finish on the old connection details first, so a revoked key stays in use until then.
	 */
	evictServer(id: string): void {
		this.clientCache.evict(id);
	}

	clearSolveCaches(): void {
		this.clientCache.clearSolveCaches();
	}

	/**
	 * Drop every retained `.gh` byte entry. Safe at any time: entries key on an
	 * immutable version id, so clearing costs a storage re-read and nothing else.
	 */
	clearDefinitionCache(): void {
		this.byteCache.clear();
	}

	stats(): SolveEngineStats {
		return {
			client: this.clientCache.solveCacheStats(),
			definitionBytes: this.byteCache.stats(),
			coalescing: { inFlight: this.singleFlight.inFlight() }
		};
	}

	async solve(args: SolveEngineSolveArgs): Promise<SolveEngineOutcome> {
		const { definitionSource, identity } = this.resolveDefinitionSource(args);
		const startedAt = performance.now();
		const elapsed = () => performance.now() - startedAt;

		// `addEventListener` never fires for a signal that already aborted, so a client gone during
		// the host's own awaits would otherwise still pay for a solve.
		if (args.signal.aborted) return { kind: 'client_abort', durationMs: 0 };

		let client: CachedClient;
		try {
			client = await this.clientCache.getClient(args.server, {
				definitionGuid: args.definitionGuid
			});
		} catch (error) {
			if (args.signal.aborted) return { kind: 'client_abort', durationMs: elapsed() };
			if (error instanceof ComputeError && error.code === ErrorCodes.ABORTED) {
				return interrupted(elapsed());
			}
			return { kind: 'compute_error', durationMs: elapsed(), error };
		}
		if (args.signal.aborted) return { kind: 'client_abort', durationMs: elapsed() };

		const treeBuildStart = performance.now();
		let inputTree;
		try {
			inputTree = buildSolveInputTree(args.inputs, args.values);
		} catch (error) {
			return { kind: 'compute_error', durationMs: elapsed(), error };
		}
		const treeBuildMs = performance.now() - treeBuildStart;

		const flight = await this.singleFlight.run(
			`${identity}:${args.server.id}:${this.clientGeneration(client)}:${stableStringify(inputTree)}`,
			(signal) =>
				runSolvePipeline({
					definitionSource,
					inputTree,
					client,
					responseMaxBytes: this.limits.computeResponseMaxBytes,
					solveDeadlineMs: this.limits.solveDeadlineMs,
					selvaEvents: args.selvaEvents,
					signal
				}),
			args.signal
		);

		// Before encoding: a caller that left a shared flight must not stringify for nobody.
		if (args.signal.aborted) return { kind: 'client_abort', durationMs: elapsed() };
		if (flight.kind !== 'solved') return flight;

		let encoded;
		try {
			encoded = await flight.encoder.encode(args.acceptEncoding ?? '');
		} catch (error) {
			return { kind: 'compute_error', durationMs: elapsed(), error };
		}
		if (encoded === 'too_large') return { kind: 'too_large' };

		const { body, serializedBytes, serializeMs, gzipMs } = encoded;
		const { solveMs, response } = flight;
		const serverTotalMs = performance.now() - (args.loadStartMs ?? startedAt);
		const serverTiming = buildServerTiming({
			defLoadMs: args.defLoadMs ?? 0,
			treeBuildMs,
			solveMs,
			serializeMs,
			gzipMs,
			serverTotalMs,
			rhino: flight.rhino,
			settle: flight.settle,
			defBytes: flight.defBytes,
			prepMarks: args.prepMarks ?? []
		});

		return {
			kind: 'ok',
			envelope: buildEnvelope(encoded, response, serverTiming, {
				treeBuildMs,
				solveMs,
				serializeMs,
				gzipMs,
				serverTotalMs,
				serializedBytes,
				compressedBytes: encoded.encoding === 'gzip' ? (body as Uint8Array).byteLength : null
			}),
			solveMs,
			errorCount: response.errors?.length ?? 0,
			warningCount: response.warnings?.length ?? 0
		};
	}

	/**
	 * The response for an outcome; the mapping from outcome to status lives here. Throws
	 * `compute_error`'s error: what it means for the caller is the host's to decide.
	 */
	toWebResponse(outcome: SolveEngineOutcome): Response {
		const fail = (status: number, body: { message: string; retryAfter?: number }) =>
			new Response(JSON.stringify(body), {
				status,
				headers: {
					'Content-Type': 'application/json',
					...(body.retryAfter !== undefined ? { 'Retry-After': String(body.retryAfter) } : {})
				}
			});

		switch (outcome.kind) {
			case 'ok':
				// The cast is a TS gap: `Uint8Array<ArrayBufferLike>` is not a body type, though it works.
				return new Response(outcome.envelope.body as ConstructorParameters<typeof Response>[0], {
					status: 200,
					headers: outcome.envelope.headers
				});
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

	/**
	 * Part of the coalesce key: after an eviction the id stays and the client changes, and a new
	 * caller joining a draining flight would get an answer from the old URL or key.
	 */
	private clientGeneration(client: CachedClient): number {
		let generation = this.clientGenerations.get(client);
		if (generation === undefined) {
			generation = ++this.lastClientGeneration;
			this.clientGenerations.set(client, generation);
		}
		return generation;
	}

	private resolveDefinitionSource(args: SolveEngineSolveArgs): {
		definitionSource: SolveDefinition;
		identity: string;
	} {
		const source = args.definitionSource;

		if (isByteCacheRef(source) || isDefinitionRef(source)) {
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
