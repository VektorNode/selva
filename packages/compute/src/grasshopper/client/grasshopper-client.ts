import { ErrorCodes, ComputeError } from '@/core/errors';
import { getLogger } from '@/core/utils/logger';
import { readField } from '@/core/utils/read-field';
import ComputeServerStats from '../server/compute-server-stats';
import { validateServerUrl } from '@/core/server/validate-server-url';
import { classifyProbeFailure, type ProbeFailure } from '@/core/server/classify-probe-failure';
import { RetryPolicy } from '@/core/types';

import { fetchDefinitionIO, fetchParsedDefinitionIO } from '../io/definition-io';
import { solveGrasshopperDefinition, solveWithServerCacheKey } from '../solve';
import {
	GrasshopperComputeConfig,
	GrasshopperComputeResponse,
	DataTree,
	SelvaEventTarget
} from '../types';
import { isDefinitionRef, type SolveDefinition } from '@/core/definition-ref';
import { SolveScheduler } from '../scheduler/solve-scheduler';
import type { SolveSchedulerOptions } from '../scheduler/types';

/**
 * Per-call options that override the client's default ComputeConfig values.
 *
 * Use these for per-request control without mutating the client config:
 * - `signal` — cancel a specific solve (e.g. when a slider value is superseded)
 * - `timeoutMs` — extend timeout for a long-running solve, or pass `0` to disable
 * - `retry` — override retry policy for this call only
 */
export interface SolveOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	retry?: RetryPolicy;
	/** Per-solve live-event callback, forwarded onto the request body. */
	selvaevents?: SelvaEventTarget;
}

/** Options for {@link GrasshopperClient.create} that shape construction, not the solves. */
export interface CreateClientOptions {
	/**
	 * Retry ladder for the liveness probe: `attempts` retries after the first probe (default 2),
	 * with exponential backoff from `baseDelayMs` (default 250) capped at `maxDelayMs` (default 1000).
	 * Independent of `config.retry`, which governs solves only.
	 */
	probe?: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number };
}

function describeDefinition(definition: SolveDefinition): string {
	if (isDefinitionRef(definition)) return `ref:${definition.key}`;
	if (typeof definition === 'string' && definition.length < 200) return definition;
	return '...content...';
}

interface DataTreeSummaryEntry {
	param: string;
	items: number;
	/** Summed `data` string lengths. */
	bytes: number;
}

/**
 * Stands in for the input tree on errors: the tree can hold multi-MB geometry, and every logger
 * or telemetry sink that keeps the error would pin it. Never throws on a malformed tree.
 */
function summarizeDataTree(dataTree: DataTree[]): DataTreeSummaryEntry[] {
	if (!Array.isArray(dataTree)) return [];

	return dataTree.map((tree) => {
		let items = 0;
		let bytes = 0;

		const innerTree = readField<Record<string, unknown>>(tree, 'innerTree');
		if (innerTree && typeof innerTree === 'object') {
			for (const branch of Object.values(innerTree)) {
				if (!Array.isArray(branch)) continue;
				items += branch.length;
				for (const item of branch) {
					const data = (item as { data?: unknown } | null)?.data;
					if (typeof data === 'string') bytes += data.length;
				}
			}
		}

		return { param: readField<string>(tree, 'paramName') ?? '<unnamed>', items, bytes };
	});
}

/**
 * GrasshopperClient provides a simple API for interacting with a Rhino Compute server and grasshopper.
 *
 * @public This is the recommended high-level API for Rhino Compute operations.
 *
 * **Security Warning:**
 * Using this client in a browser environment exposes your server URL and API key to users.
 * For production, use this library server-side or proxy requests through your own backend.
 *
 * @example
 * ```typescript
 * const client = await GrasshopperClient.create({
 *   serverUrl: 'http://localhost:6500',
 *   apiKey: 'your-api-key'
 * });
 *
 * try {
 *   const io = await client.getIO(definitionUrl);
 *   const result = await client.solve(definitionUrl, TreeBuilder.fromInputParams(io.inputs));
 * } finally {
 *   await client.dispose(); // Clean up resources
 * }
 * ```
 */
export default class GrasshopperClient {
	private readonly config: GrasshopperComputeConfig;
	public readonly serverStats: ComputeServerStats;
	private disposed = false;

	/**
	 * Per-probe timeout for the `create()` liveness gate. A healthy `GET /` on the
	 * proxy answers in milliseconds; this bound only ever applies to a server that
	 * is not answering, where every extra second is multiplied by the retry count
	 * and paid by whoever is waiting on the solve.
	 */
	private static readonly CREATE_PROBE_TIMEOUT_MS = 2000;

	private constructor(config: GrasshopperComputeConfig) {
		this.config = {
			...config,
			serverUrl: validateServerUrl(config.serverUrl),
			debug: config.debug ?? false
		};
		this.serverStats = new ComputeServerStats(this.config.serverUrl, this.config);
	}

	/**
	 * Creates and initializes a GrasshopperClient with server validation.
	 *
	 * The pre-flight liveness probe (a GET on the proxy root `/`) is a
	 * single-sample boolean gate that reads a cold or briefly-busy-but-up server
	 * as offline. To avoid failing construction on that transient class, the probe
	 * is retried with a short exponential backoff before giving up.
	 *
	 * Retries stop early when {@link classifyProbeFailure} says waiting cannot
	 * change the answer — connection refused, or a 401/403. This runs in front of
	 * a user who clicked Solve, so the retry ladder must not spend its whole
	 * budget confirming that a machine is switched off.
	 *
	 * @throws {ComputeError} with code NETWORK_ERROR if the server stays
	 *   unreachable across all attempts. `context.probeVerdict` carries the
	 *   {@link ProbeVerdict} so callers can render a specific cause.
	 * @throws {ComputeError} with code INVALID_CONFIG if configuration is invalid
	 */
	static async create(
		config: GrasshopperComputeConfig,
		options: CreateClientOptions = {}
	): Promise<GrasshopperClient> {
		const client = new GrasshopperClient(config);

		const attempts = Math.max(1, (options.probe?.attempts ?? 2) + 1);
		const baseDelayMs = options.probe?.baseDelayMs ?? 250;
		const maxDelayMs = options.probe?.maxDelayMs ?? 1000;

		let lastProbe: Awaited<ReturnType<ComputeServerStats['probeServer']>> | undefined;
		let failure: ProbeFailure | null = null;
		let used = 0;
		for (let attempt = 0; attempt < attempts; attempt++) {
			used = attempt + 1;
			lastProbe = await client.serverStats.probeServer(GrasshopperClient.CREATE_PROBE_TIMEOUT_MS);
			if (lastProbe.online) {
				return client;
			}

			failure = classifyProbeFailure(lastProbe);
			// Nothing about a refused connection or a rejected key improves by
			// asking again — fail now and let the caller say why.
			if (failure && !failure.retryable) break;

			if (attempt < attempts - 1) {
				const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		await client.dispose();
		const status = lastProbe?.status;
		const message = failure
			? `Rhino Compute server is not available. ${failure.summary}`
			: 'Rhino Compute server is not online';
		throw new ComputeError(message, ErrorCodes.NETWORK_ERROR, {
			...(status !== undefined && { statusCode: status }),
			context: {
				serverUrl: client.config.serverUrl,
				// What we actually spent, not the ceiling — an early break makes
				// these differ, and the gap is the useful part when reading a log.
				attempts: used,
				maxAttempts: attempts,
				...(failure && { probeVerdict: failure.verdict, probeRetryable: failure.retryable }),
				...(status !== undefined && { lastProbeStatus: status }),
				...(lastProbe?.error !== undefined && { lastProbeError: lastProbe.error })
			}
		});
	}

	/**
	 * Gets the client's configuration.
	 * Useful for passing to lower-level functions.
	 */
	public getConfig(): GrasshopperComputeConfig {
		this.ensureNotDisposed();
		return { ...this.config };
	}

	/**
	 * Get input/output parameters of a Grasshopper definition.
	 */
	public async getIO(definition: string | Uint8Array) {
		this.ensureNotDisposed();
		return fetchParsedDefinitionIO(definition, this.config);
	}

	public async getRawIO(definition: string | Uint8Array) {
		this.ensureNotDisposed();
		return fetchDefinitionIO(definition, this.config);
	}

	/**
	 * Run a compute job with a Grasshopper definition.
	 *
	 * @throws {ComputeError} with code INVALID_INPUT if definition is empty
	 * @throws {ComputeError} with code NETWORK_ERROR if server is offline
	 * @throws {ComputeError} with code COMPUTATION_ERROR if computation fails.
	 *   On a partial-success response (some outputs computed, some errored) the
	 *   error's `context.values` carries the outputs that did compute — pass
	 *   `{ values } as GrasshopperComputeResponse` to the response processors to
	 *   render them. `context.inputSummary` describes the inputs (param names,
	 *   item counts, byte sizes) without pinning the full data tree.
	 */
	public async solve(
		definition: SolveDefinition,
		dataTree: DataTree[],
		options?: SolveOptions
	): Promise<GrasshopperComputeResponse> {
		this.ensureNotDisposed();

		try {
			// Validate inputs
			if (typeof definition === 'string' && !definition.trim()) {
				throw new ComputeError('Definition URL/content is required', ErrorCodes.INVALID_INPUT, {
					context: { receivedUrl: definition }
				});
			} else if (definition instanceof Uint8Array && definition.length === 0) {
				throw new ComputeError('Definition content is empty', ErrorCodes.INVALID_INPUT);
			} else if (isDefinitionRef(definition) && !definition.key.trim()) {
				throw new ComputeError('DefinitionRef key is empty', ErrorCodes.INVALID_INPUT);
			}

			const effectiveConfig: GrasshopperComputeConfig = {
				...this.config,
				...(options?.signal !== undefined && { signal: options.signal }),
				...(options?.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
				...(options?.retry !== undefined && { retry: options.retry }),
				...(options?.selvaevents !== undefined && { selvaevents: options.selvaevents })
			};

			const result = await solveGrasshopperDefinition(dataTree, definition, effectiveConfig);

			// A partial success (HTTP 500 carrying both `values` and `errors`) must not pass as a result.
			const solveErrors = readField<unknown[]>(result, 'errors');
			if (Array.isArray(solveErrors) && solveErrors.length > 0) {
				throw new ComputeError(
					solveErrors.map(String).join('; ') || 'Computation failed',
					ErrorCodes.COMPUTATION_ERROR,
					{
						context: {
							definition: describeDefinition(definition),
							inputSummary: summarizeDataTree(dataTree),
							errors: solveErrors,
							warnings: readField<unknown[]>(result, 'warnings'),
							values: result.values
						}
					}
				);
			}

			return result;
		} catch (error) {
			if (this.config.debug) {
				getLogger().error('Compute failed:', error);
			}

			if (error instanceof ComputeError) {
				throw error;
			}

			throw new ComputeError(
				error instanceof Error ? error.message : String(error),
				ErrorCodes.COMPUTATION_ERROR,
				{
					context: {
						definition: describeDefinition(definition),
						inputSummary: summarizeDataTree(dataTree)
					},
					originalError: error
				}
			);
		}
	}

	/**
	 * Create a scheduler bound to this client. Use a scheduler for any UI surface
	 * that fires solves frequently (sliders, live editors) or that needs cancel
	 * semantics, response caching, or state observability.
	 *
	 * Multiple schedulers can be created from a single client — typically one per
	 * UI surface so their queues stay independent.
	 *
	 * @example
	 * ```ts
	 * const sliderScheduler = client.createScheduler({ mode: 'latest-wins' });
	 * const submitScheduler = client.createScheduler({ mode: 'queue', timeoutMs: 0, retry: { attempts: 1 } });
	 * ```
	 */
	public createScheduler(options?: SolveSchedulerOptions): SolveScheduler {
		this.ensureNotDisposed();
		return new SolveScheduler(
			(definition, dataTree, cacheKey, config) =>
				solveWithServerCacheKey(dataTree, cacheKey, definition, config),
			this.config,
			options
		);
	}

	/**
	 * Disposes of client resources.
	 * Call this when you're done using the client.
	 */
	public async dispose(): Promise<void> {
		if (this.disposed) return;

		this.disposed = true;
		await this.serverStats.dispose();
	}

	private ensureNotDisposed(): void {
		if (this.disposed) {
			throw new ComputeError(
				'GrasshopperClient has been disposed and cannot be used',
				ErrorCodes.INVALID_STATE
			);
		}
	}
}
