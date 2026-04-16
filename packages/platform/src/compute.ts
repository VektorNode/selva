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
	/** Base URL of the Rhino.Compute instance, e.g. http://localhost:5000 */
	serverUrl: string;
	/** Optional API key sent as RhinoComputeKey header */
	apiKey?: string;
	/** Request timeout in milliseconds. Default: 30000 */
	timeoutMs?: number;
	/** Number of retries on transient failure. Default: 0 */
	retryCount?: number;
}

export interface SolveRequest {
	/** GUID of the definition being solved — enables per-definition routing */
	definitionGuid?: string;
	/** Arbitrary hints for routing decisions (e.g. required plugin versions) */
	hints?: Record<string, string>;
}

export interface IComputeServerProvider {
	/**
	 * Resolve which compute server to use for a given solve request.
	 * The simplest implementation always returns the same server.
	 */
	getServer(request?: SolveRequest): Promise<ComputeServerConfig>;

	/**
	 * Return all configured servers.
	 * Used by the admin health dashboard to show server pool state.
	 */
	listServers(): Promise<ComputeServerConfig[]>;
}
