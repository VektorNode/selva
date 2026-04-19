export interface ComputeServerConfig {
	/** UUID v4 primary key */
	id: string;
	/** Human-readable display label */
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
	/** UUID of the server to use when no routing rule matches. Falls back to servers[0]. */
	defaultServerId?: string;
}

export interface SolveRequest {
	/** GUID of the definition being solved — enables per-definition routing */
	definitionGuid?: string;
	/** Arbitrary hints for routing decisions (e.g. required plugin versions) */
	hints?: Record<string, string>;
}
