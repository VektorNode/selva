/**
 * `SolveEngine` — the facade that owns everything a consumer needs to run
 * interactive Grasshopper solves: the per-server warm-client cache, the
 * definition-byte cache, single-flight coalescing, the pipeline call, and the
 * outcome→HTTP mapping. Composes `createClientCache` + `createDefinitionByteCache`
 * + `createSolveCacheSingleFlight` + `runSolvePipeline` — the same primitives a
 * hand-assembled app route already wires, minus the wiring.
 *
 * Deliberately does NOT read env itself (no `resolveComputeLimits` call here):
 * `@selvajs/server`, which owns that function, depends on `@selvajs/solve`, so
 * the reverse import would be circular. A consumer resolves its own limits
 * (`resolveComputeLimits` from `@selvajs/server/compute`, or any equivalent) and
 * passes the handful of fields this engine actually needs.
 *
 * What stays OUT, on purpose (matches `server/index.ts`'s existing boundary):
 * auth, DB reads, share tokens, rate limiting, metric sinks, and which compute
 * server to use (`resolveServerForOrg`-equivalent) — all app policy, supplied
 * per-call via `SolveEngineSolveArgs.server`.
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
 * The subset of `ComputeLimits` (`@selvajs/server/compute`) the engine needs,
 * passed straight through to `createClientCache` — pass the resolved object
 * through, its extra fields are ignored.
 */
export interface SolveEngineLimits {
	maxSolveDurationMs: number;
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
	/** Required — the engine does not read env itself (see module doc). */
	limits: SolveEngineLimits;
	logger?: ILogger;
	/** Max distinct warm compute servers before the LRU evicts the oldest. Default 16 (see `createClientCache`). */
	maxWarmComputeServers?: number;
	/** Concise cache/timing logs when truthy; `'verbose'` also enables full lib-level request/response dumps. Default off. */
	debug?: ClientCacheDebug;
	onDebugLog?: (message: string) => void;
	/** Fired when a caller joins an already-in-flight solve instead of running its own (`createSolveCacheSingleFlight`'s `onJoin`). */
	onSolveCoalesced?: (key: string) => void;
}

/**
 * `definitionSource` accepts every form `runSolvePipeline` does, plus the
 * `{versionId, load}` sugar that builds (and caches) a `ByteCacheRef` internally.
 * A `ByteCacheRef` obtained from `engine.definitionRef()` ahead of time (e.g. to
 * read its bytes for schema extraction before solving) is accepted directly and
 * NOT re-wrapped — recognized by its `outcome` field, which a plain external
 * `DefinitionRef` never has.
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
	 * Coalesce-key identity for a raw `Uint8Array`/`string` `definitionSource`,
	 * which has no natural identity the way a `DefinitionRef`'s `.key` does.
	 * Required in that case — `solve()` throws without it, rather than silently
	 * hashing bytes (a different identity convention than the rest of the
	 * package, which keys on immutable ids). Ignored for the other source forms.
	 */
	definitionKey?: string;
	inputs: PipelineInput[];
	values: Record<string, unknown>;
	signal: AbortSignal;
	acceptEncoding?: string;
	/** Stamped as `X-Selva-Definition` on this solve's client — see `ClientCache.getClient`. */
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
			maxSolveDurationMs: this.limits.maxSolveDurationMs,
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

		// Abort/hasWaiters dance: a coalesced solve is shared, so it must not
		// follow one caller's disconnect and 499 every other waiter. Only a
		// solo run (no one has joined by the time this caller disconnects)
		// propagates its own abort.
		const abortController = new AbortController();
		let hasWaiters = false;
		args.signal.addEventListener(
			'abort',
			() => {
				if (!hasWaiters) abortController.abort();
			},
			{ once: true }
		);

		const acceptEncoding = args.acceptEncoding ?? '';
		const outcome = await this.singleFlight.run(
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
					maxSolveDurationMs: this.limits.maxSolveDurationMs,
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

		if (outcome.kind !== 'ok') return outcome;

		// Re-key the (possibly shared) envelope to THIS caller's Accept-Encoding —
		// runs per-call, after the shared `singleFlight.run` await resolves for
		// each waiter individually, so every waiter gets its own correct wire form.
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
