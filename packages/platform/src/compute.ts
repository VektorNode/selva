/**
 * Compute server provider interface.
 *
 * Implement to support:
 * - Single server (built-in default)
 * - Server pool with load balancing
 * - Per-definition routing (e.g. definition A always goes to server B)
 * - Dynamic provisioning
 */

export interface ComputeServerConfig {
	/** Unique human-readable identifier. Referenced by ComputeConfig.defaultServer. */
	label: string;
	/** Base URL of the Rhino.Compute instance, e.g. http://localhost:5000 */
	serverUrl: string;
	/** Optional API key sent as RhinoComputeKey header */
	apiKey?: string;
	/** Request timeout in milliseconds. Default: 30000 */
	timeoutMs?: number;
	/** Number of retries on transient failure. Default: 0 */
	retryCount?: number;
}

export interface ComputeConfig {
	servers: ComputeServerConfig[];
	/** Label of the server to use when no routing rule matches. Falls back to servers[0]. */
	defaultServer?: string;
}

export interface SolveRequest {
	/** GUID of the definition being solved — enables per-definition routing */
	definitionGuid?: string;
	/** Arbitrary hints for routing decisions (e.g. required plugin versions) */
	hints?: Record<string, string>;
}

export interface IComputeServerProvider {
	/** Resolve which compute server to use for a given solve request. */
	getServer(request?: SolveRequest): Promise<ComputeServerConfig>;

	/** Return the default server, or undefined if none configured. */
	getDefaultServer(): Promise<ComputeServerConfig | undefined>;

	/** Return the full config. Used by the admin UI. */
	getConfig(): Promise<ComputeConfig>;

	/** Replace the full config atomically. Used by the admin UI. */
	saveConfig(config: ComputeConfig): Promise<void>;
}

