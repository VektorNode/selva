import { ComputeError, ErrorCodes } from '@/core/errors';
import { getLogger } from '@/core/utils/logger';
import { validateServerUrl } from '@/core/server/validate-server-url';
import { buildAuthHeaders } from '@/core/compute-fetch/request';
import { readBodyText } from '@/core/compute-fetch/read-body';
import { isRedirect } from '@/core/compute-fetch/response';
import type { ComputeAuth } from '@/core/types';

export interface ServerVersion {
	rhino: string;
	compute: string;
	git_sha: string | null;
}

export interface ServerStats {
	isOnline: boolean;
	version?: ServerVersion;
	activeChildren?: number;
}

/**
 * ComputeServerStats provides methods to query Rhino Compute server statistics.
 *
 * @public Use this for server health monitoring and statistics.
 *
 * @example
 * ```typescript
 * const stats = new ComputeServerStats('http://localhost:6500', 'your-api-key');
 *
 * try {
 *   const isOnline = await stats.isServerOnline();
 *   const children = await stats.getActiveChildren();
 *   const version = await stats.getVersion();
 *
 *   // Or get everything at once
 *   const allStats = await stats.getServerStats();
 * } finally {
 *   await stats.dispose(); // Clean up resources
 * }
 * ```
 */
export default class ComputeServerStats {
	private readonly serverUrl: string;
	private readonly headers: Record<string, string>;
	private disposed = false;
	private activeMonitors: Set<() => void> = new Set();

	/** Timeout (ms) for the fast read/monitoring endpoints. */
	private static readonly DEFAULT_TIMEOUT_MS = 5000;

	/** Timeout (ms) for child-lifecycle POSTs — a cold Windows child can take ~30s to spawn. */
	private static readonly LIFECYCLE_TIMEOUT_MS = 60_000;

	/** Floor for `monitor()`'s `intervalMs` — anything lower hot-loops the server. */
	private static readonly MIN_MONITOR_INTERVAL_MS = 100;

	/** Every control-plane answer is a count, a version or a short map. */
	private static readonly MAX_BODY_BYTES = 1 << 20;

	/**
	 * @param serverUrl - Base URL of the Rhino Compute server with http:// or https:// scheme (e.g., 'http://localhost:6500')
	 * @param auth - An API key, or the same auth fields a solve's `ComputeConfig` carries
	 *   (`apiKey`, `apiKeyHeader`, `authToken`, `headers`).
	 */
	constructor(serverUrl: string, auth?: string | ComputeAuth) {
		this.serverUrl = validateServerUrl(serverUrl);
		this.headers = {
			...buildAuthHeaders(typeof auth === 'string' ? { apiKey: auth } : (auth ?? {})),
			'Content-Type': 'application/json'
		};
	}

	/**
	 * Aborts after `timeoutMs` so a hung connection can't stall a probe or `monitor()`; `0` disables
	 * it. Redirects are not followed: fetch would carry the API key header to the target.
	 */
	private fetchWithTimeout(
		url: string,
		init: RequestInit = {},
		timeoutMs: number = ComputeServerStats.DEFAULT_TIMEOUT_MS
	): Promise<Response> {
		const requestInit: RequestInit = { ...init, headers: this.headers, redirect: 'manual' };
		if (timeoutMs > 0 && !requestInit.signal) {
			requestInit.signal = AbortSignal.timeout(timeoutMs);
		}
		return fetch(url, requestInit);
	}

	/**
	 * The response body of `path`, or `null` (logged) on a non-2xx or a network
	 * failure. Throws only when disposed.
	 */
	private async getText(
		path: string,
		init: RequestInit = {},
		timeoutMs: number = ComputeServerStats.DEFAULT_TIMEOUT_MS
	): Promise<string | null> {
		this.ensureNotDisposed();
		const label = `${init.method ?? 'GET'} ${path}`;
		try {
			const response = await this.fetchWithTimeout(`${this.serverUrl}${path}`, init, timeoutMs);
			if (!response.ok) {
				getLogger().warn(`[ComputeServerStats] ${label} failed:`, response.status);
				await response.body?.cancel().catch(() => {});
				return null;
			}
			const { text, truncated } = await readBodyText(response, ComputeServerStats.MAX_BODY_BYTES);
			if (truncated) {
				getLogger().warn(`[ComputeServerStats] ${label} answered with an oversized body`);
				return null;
			}
			return text;
		} catch (err) {
			getLogger().warn(`[ComputeServerStats] ${label} errored:`, err);
			return null;
		}
	}

	/**
	 * Check if the server is online.
	 *
	 * This is a single-sample probe: it returns `true` only on a 2xx or a redirect
	 * from the proxy liveness root `/`, and `false` for every other outcome (4xx/5xx,
	 * network error, or timeout). A cold or briefly-busy-but-up server can therefore
	 * read as offline — callers that gate on this (e.g. client construction)
	 * should retry rather than treat a single `false` as authoritative.
	 *
	 * @param timeoutMs - Abort the probe after this many ms (default: 5000).
	 *   Pass `0` to disable the timeout. Prevents a hung connection from
	 *   stalling the caller indefinitely.
	 */
	public async isServerOnline(
		timeoutMs: number = ComputeServerStats.DEFAULT_TIMEOUT_MS
	): Promise<boolean> {
		return (await this.probeServer(timeoutMs)).online;
	}

	/**
	 * Detailed liveness probe backing {@link isServerOnline}.
	 *
	 * Reports what the probe actually saw so callers can distinguish "connection
	 * failed" (`error` set) from "server answered non-2xx" (`status` set) — e.g.
	 * a 401 from a proxy that requires an API key is a misconfiguration, not an
	 * offline server. Same single-sample caveat as {@link isServerOnline}.
	 *
	 * @param timeoutMs - Abort the probe after this many ms (default: 5000).
	 *   Pass `0` to disable the timeout.
	 * @returns `online` plus either the HTTP `status` the server answered with,
	 *   or the `error` the connection attempt failed with.
	 */
	public async probeServer(
		timeoutMs: number = ComputeServerStats.DEFAULT_TIMEOUT_MS
	): Promise<{ online: boolean; status?: number; error?: string }> {
		this.ensureNotDisposed();

		// The rhino.compute proxy has no `/healthcheck` route; its real liveness
		// signal is `GET /`, which returns "compute.rhino3d running". Probing an
		// unknown path would instead be forwarded to a child and only tells us the
		// proxy can reach one. Some builds redirect `/` to rhino3d.com instead:
		// answering with a redirect is alive.
		const url = `${this.serverUrl}/`;

		try {
			const response = await this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
			// Unread, the body would hold its connection until garbage collection.
			await response.body?.cancel().catch(() => {});
			return { online: response.ok || isRedirect(response), status: response.status };
		} catch (err) {
			getLogger().debug('[ComputeServerStats] Fetch error:', err);
			return {
				online: false,
				error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
			};
		}
	}

	/**
	 * Get the number of active child processes on the server.
	 *
	 * By default the proxy's `/activechildren` endpoint will *spawn* children up
	 * to the configured count if none are running, then report the count — which
	 * wakes (and bills) an idle server. Pass `{ initialize: false }` for a passive
	 * read that reports the current count without spawning; use this for
	 * monitoring or before a purge/probe where you must not wake the server.
	 *
	 * @param options.initialize - When `false`, append `?initialize=false` so the
	 *   server reports without spawning. Defaults to `true` (the server's default).
	 * @returns Number of active children, or null if unavailable
	 */
	public async getActiveChildren(options: { initialize?: boolean } = {}): Promise<number | null> {
		const { initialize = true } = options;
		// `initialize` may spawn children before answering: give it the lifecycle budget.
		const body = initialize
			? await this.getText('/activechildren', {}, ComputeServerStats.LIFECYCLE_TIMEOUT_MS)
			: await this.getText('/activechildren?initialize=false');
		if (body === null) return null;

		// Strict: `parseInt` would read an error page starting "302 Found" as 302 children.
		const text = body.trim();
		if (!/^\d+$/.test(text)) {
			getLogger().warn('[ComputeServerStats] /activechildren answered with a non-numeric body');
			return null;
		}
		return parseInt(text, 10);
	}

	/**
	 * Get the server version information.
	 *
	 * @returns Version object with rhino, compute, and git_sha, or null if unavailable
	 */
	public async getVersion(): Promise<ServerVersion | null> {
		const text = await this.getText('/version');
		if (text === null) return null;

		// A non-JSON body is a bare version string.
		const json = tryParseJson(text) as {
			rhino?: string;
			compute?: string;
			git_sha?: string | null;
		} | null;
		if (json == null) return { rhino: text, compute: '', git_sha: null };
		return { rhino: json.rhino ?? '', compute: json.compute ?? '', git_sha: json.git_sha ?? null };
	}

	/**
	 * Get the plugins installed on the server.
	 *
	 * Returns a `name → version` map of non-core plugins the server has loaded,
	 * or `null` if the request failed. Pass `kind` to choose which inventory:
	 * `'gh'` (default) lists Grasshopper add-on assemblies via
	 * `/plugins/gh/installed`; `'rhino'` lists Rhino plugins via
	 * `/plugins/rhino/installed`. Plugins that ship with Rhino / are core
	 * libraries are excluded by the server.
	 *
	 * @param kind - `'gh'` for Grasshopper add-ons (default) or `'rhino'` for Rhino plugins.
	 * @returns Map of plugin name to version, or `null` on failure.
	 *
	 * @example
	 * ```ts
	 * const gh = await stats.getInstalledPlugins();        // Grasshopper add-ons
	 * const selvaVersion = gh?.['Selva'] ?? null;
	 * ```
	 */
	public async getInstalledPlugins(
		kind: 'gh' | 'rhino' = 'gh'
	): Promise<Record<string, string> | null> {
		const text = await this.getText(`/plugins/${kind}/installed`);
		const json = text === null ? undefined : tryParseJson(text);
		return json && typeof json === 'object' ? (json as Record<string, string>) : null;
	}

	/**
	 * Get comprehensive server statistics.
	 * Fetches all available server information in parallel.
	 *
	 * @returns Object containing server status and available stats
	 */
	public async getServerStats(): Promise<ServerStats> {
		this.ensureNotDisposed();

		const isOnline = await this.isServerOnline();

		if (!isOnline) {
			return { isOnline: false };
		}

		// Passive child count — never spawn from a stats read, or merely viewing
		// server health would wake (and bill) an idle server.
		const [version, activeChildren] = await Promise.all([
			this.getVersion(),
			this.getActiveChildren({ initialize: false })
		]);

		return {
			isOnline: true,
			...(version && { version }),
			...(activeChildren !== null && { activeChildren })
		};
	}

	/**
	 * Purge the server's solve-results / URL-data cache.
	 *
	 * POSTs to `cache/purge` and returns the number of entries removed, or `null`
	 * if the request failed. This clears cached solve responses and fetched
	 * definition-URL data; it does NOT evict the definition cache (active
	 * `pointer` references stay valid).
	 *
	 * **Caveat:** `cache/purge` is forwarded by the rhino.compute proxy to a
	 * single round-robin-selected child, so in a multi-child deployment one call
	 * purges one child's cache. Call repeatedly (or size the pool to 1) if you
	 * need a fleet-wide purge.
	 *
	 * @returns Number of entries removed, or `null` on failure.
	 *
	 * @example
	 * ```ts
	 * const removed = await stats.purgeCache();
	 * if (removed !== null) console.log(`Purged ${removed} cached solves`);
	 * ```
	 */
	public async purgeCache(): Promise<number | null> {
		const text = await this.getText('/cache/purge', { method: 'POST' });
		const json = text === null ? undefined : tryParseJson(text);
		const purged = (json as { purged?: unknown } | null | undefined)?.purged;
		return typeof purged === 'number' ? purged : null;
	}

	/**
	 * Best-effort fleet-wide cache purge across a multi-child deployment.
	 *
	 * A single {@link purgeCache} POST is forwarded by the rhino.compute proxy to
	 * just ONE round-robin-selected child, so the other children keep serving
	 * stale cached solves. There is no proxy endpoint that addresses children
	 * individually, so this method reads the active child count (passively, never
	 * spawning) and fires `2 × count` sequential purges, relying on the proxy's
	 * round-robin to spread the hits across the pool.
	 *
	 * **This is best-effort, not a guarantee.** Round-robin can revisit one child
	 * and skip another; under concurrent traffic the rotation drifts. The result's
	 * `confident` flag is `true` only when the server reports a single child (where
	 * one purge is exact) — surface it so callers don't over-promise. For a hard
	 * fleet-wide guarantee, run the deployment at `--childcount 1` or add a
	 * server-side fan-out endpoint.
	 *
	 * @returns `{ totalPurged, calls, children, confident }`, or `null` if the
	 *   child count couldn't be read (server unreachable). `totalPurged` sums the
	 *   per-call counts; `calls` is how many purges were issued; `children` is the
	 *   reported pool size; `confident` is `true` only at a single-child pool.
	 *
	 * @example
	 * ```ts
	 * const r = await stats.purgeAllChildren();
	 * if (r && !r.confident) {
	 *   console.warn(`Purged ~${r.totalPurged} across ${r.children} children (best-effort)`);
	 * }
	 * ```
	 */
	public async purgeAllChildren(): Promise<{
		totalPurged: number;
		calls: number;
		children: number;
		confident: boolean;
	} | null> {
		this.ensureNotDisposed();

		// Passive read — must not spawn children just to purge them.
		const children = await this.getActiveChildren({ initialize: false });
		if (children === null) {
			getLogger().warn('[ComputeServerStats] purgeAllChildren: could not read child count');
			return null;
		}

		if (children === 0) {
			// No live children means nothing is cached on the compute side.
			return { totalPurged: 0, calls: 0, children: 0, confident: true };
		}

		// 2× the pool size gives round-robin a strong chance of reaching every
		// child at least once. Sequential (not parallel) so the proxy advances its
		// round-robin cursor one child per call rather than racing them onto one.
		const calls = children * 2;
		let totalPurged = 0;
		for (let i = 0; i < calls; i++) {
			const purged = await this.purgeCache();
			if (purged !== null) totalPurged += purged;
		}

		return { totalPurged, calls, children, confident: children === 1 };
	}

	/**
	 * Get the server's current UTC clock.
	 *
	 * GETs `/servertime`, which the server emits as a JSON-encoded ISO-8601
	 * timestamp (e.g. `"2026-06-18T08:30:00Z"`). Useful for detecting clock skew
	 * between caller and server. Returns `null` if the request failed or the body
	 * isn't a parseable date.
	 *
	 * @returns A `Date` for the server's UTC time, or `null` on failure.
	 */
	public async getServerTime(): Promise<Date | null> {
		const text = await this.getText('/servertime');
		if (text === null) return null;
		// The body is a JSON string: strip its quotes.
		const date = new Date(text.trim().replace(/^"|"$/g, ''));
		return isNaN(date.getTime()) ? null : date;
	}

	/**
	 * Get how long the rhino.compute proxy has been idle.
	 *
	 * GETs `/idlespan` on the proxy, which returns the seconds elapsed since the
	 * last request was forwarded to a compute child. This is a proxy-level metric
	 * (not proxied to a child) used by autoscalers to decide when a node can be
	 * drained. Returns `null` if unavailable.
	 *
	 * @returns Idle time in seconds, or `null` on failure.
	 */
	public async getIdleSpan(): Promise<number | null> {
		const text = await this.getText('/idlespan');
		if (text === null) return null;
		const seconds = parseFloat(text.trim());
		return isNaN(seconds) ? null : seconds;
	}

	/**
	 * Fill the compute child pool up to the server's configured baseline.
	 *
	 * POSTs `/launch-children`. No-op when the pool is already at or above the
	 * configured `--childcount`. Returns `{ spawned, active }` — how many children
	 * were started and the resulting child count — or `null` on failure.
	 *
	 * To raise capacity above the baseline use {@link launchChild}; the baseline
	 * itself can only be changed by restarting rhino.compute.
	 *
	 * @returns `{ spawned, active }`, or `null` on failure.
	 */
	public async launchChildren(): Promise<{ spawned: number[]; active: number } | null> {
		return this.postJson('/launch-children');
	}

	/**
	 * Add a single compute child to the pool, optionally on a specific port.
	 *
	 * POSTs `/launch-child` (with `?port=N` when `port` is given). Unlike
	 * {@link launchChildren}, this can push the pool above the baseline, up to the
	 * server's `MaxChildren` cap. Returns `{ spawned: [port] }` on success, or
	 * `null` on failure (server replies 400 for a bad port, 409 if the port is in
	 * use, 503 at the max-children cap).
	 *
	 * @param port - Optional specific port to launch on; otherwise the next free one.
	 * @returns `{ spawned }` listing the launched port, or `null` on failure.
	 */
	public async launchChild(port?: number): Promise<{ spawned: number[] } | null> {
		const path = port === undefined ? '/launch-child' : `/launch-child?port=${port}`;
		return this.postJson(path);
	}

	/**
	 * Gracefully shut down compute children without respawning them.
	 *
	 * POSTs `/shutdown-children`. With no `port` it shuts down every child; with
	 * `port` it targets just that one. Children do not respawn, but the next
	 * `/grasshopper` request auto-spawns the pool back to the baseline. Returns
	 * `{ shutdown, active }` — how many were stopped and the remaining count — or
	 * `null` on failure.
	 *
	 * @param port - Optional port to target; omit to shut down all children.
	 * @returns `{ shutdown, active }`, or `null` on failure.
	 */
	public async shutdownChildren(
		port?: number
	): Promise<{ shutdown: number; active: number } | null> {
		const path = port === undefined ? '/shutdown-children' : `/shutdown-children?port=${port}`;
		return this.postJson(path);
	}

	/**
	 * Shut down compute children and respawn replacements (rolling restart).
	 *
	 * POSTs `/recycle-children`. With no `port` it recycles every child; with
	 * `port` it recycles just that one. The server recycles sequentially (each
	 * replacement is serving before the next child is stopped) so the pool never
	 * drops to zero mid-recycle. Returns `{ shutdown, spawned, active }`, or
	 * `null` on failure.
	 *
	 * @param port - Optional port to target; omit to recycle all children.
	 * @returns `{ shutdown, spawned, active }`, or `null` on failure.
	 */
	public async recycleChildren(
		port?: number
	): Promise<{ shutdown: number; spawned: number[]; active: number } | null> {
		const path = port === undefined ? '/recycle-children' : `/recycle-children?port=${port}`;
		return this.postJson(path);
	}

	/** A child-lifecycle POST: a spawn or recycle can take ~30 s. */
	private async postJson<T>(path: string): Promise<T | null> {
		const text = await this.getText(
			path,
			{ method: 'POST' },
			ComputeServerStats.LIFECYCLE_TIMEOUT_MS
		);
		return text === null ? null : ((tryParseJson(text) ?? null) as T | null);
	}

	/**
	 * Continuously monitor server stats at specified interval.
	 *
	 * @param callback - Function called with stats on each interval
	 * @param intervalMs - Milliseconds between checks (default: 5000). Must be a
	 *   finite number of at least 100 ms — lower values would hot-loop the server.
	 * @returns Function to stop monitoring
	 * @throws {ComputeError} `INVALID_CONFIG` if `intervalMs` is not a finite number >= 100.
	 *
	 * @example
	 * ```typescript
	 * const stopMonitoring = stats.monitor((data) => {
	 *   console.log('Server stats:', data);
	 * }, 3000);
	 *
	 * // Later...
	 * stopMonitoring();
	 * ```
	 */
	public monitor(callback: (stats: ServerStats) => void, intervalMs: number = 5000): () => void {
		this.ensureNotDisposed();

		if (!Number.isFinite(intervalMs) || intervalMs < ComputeServerStats.MIN_MONITOR_INTERVAL_MS) {
			// ComputeError (not RangeError) so `err instanceof ComputeError` holds
			// across the package's whole public surface.
			throw new ComputeError(
				`monitor() intervalMs must be a finite number >= ${ComputeServerStats.MIN_MONITOR_INTERVAL_MS}ms, ` +
					`got ${intervalMs}. Sub-${ComputeServerStats.MIN_MONITOR_INTERVAL_MS}ms polling would hot-loop the server.`,
				ErrorCodes.INVALID_CONFIG,
				{ context: { intervalMs } }
			);
		}

		let active = true;
		let currentTimeoutId: ReturnType<typeof setTimeout> | null = null;

		getLogger().info(`🔄 Starting server stats monitoring every ${intervalMs}ms`);

		const check = async () => {
			currentTimeoutId = null;
			if (!active || this.disposed) return;

			try {
				const _stats = await this.getServerStats();

				if (!active || this.disposed) return;

				try {
					callback(_stats);
				} catch (err) {
					getLogger().error('[ComputeServerStats] Monitor callback threw:', err);
				}
			} catch (err) {
				if (!active || this.disposed) {
					// dispose()/stop racing an in-flight poll is normal shutdown, not an
					// error — the nested ensureNotDisposed() throw is expected here.
					getLogger().debug('[ComputeServerStats] Monitor poll cancelled during shutdown:', err);
				} else {
					getLogger().error('[ComputeServerStats] Failed to fetch stats during monitor:', err);
				}
			}

			if (active && !this.disposed) {
				currentTimeoutId = setTimeout(() => void check(), intervalMs);
			}
		};

		const stopMonitoring = () => {
			active = false;
			if (currentTimeoutId !== null) {
				clearTimeout(currentTimeoutId);
				currentTimeoutId = null;
			}

			this.activeMonitors.delete(stopMonitoring);
		};

		this.activeMonitors.add(stopMonitoring);

		void check();

		return stopMonitoring;
	}

	/**
	 * Disposes of all resources and stops all active monitors.
	 * Call this when you're done using the stats instance.
	 */
	public async dispose(): Promise<void> {
		if (this.disposed) return;

		this.disposed = true;
		for (const stopMonitor of this.activeMonitors) {
			stopMonitor();
		}
		this.activeMonitors.clear();
	}

	private ensureNotDisposed(): void {
		if (this.disposed) {
			throw new ComputeError(
				'ComputeServerStats has been disposed and cannot be used',
				ErrorCodes.INVALID_STATE
			);
		}
	}
}

/** The parsed body, or `undefined` when it isn't JSON. */
function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
