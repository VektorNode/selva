/**
 * Shape of compute.config.json stored in the definitions directory.
 *
 * Set COMPUTE_PROVIDER=filesystem to use this file instead of
 * the COMPUTE_SERVER_URL environment variable.
 *
 * Example compute.config.json:
 * {
 *   "servers": [
 *     { "label": "local", "serverUrl": "http://localhost:5000", "timeoutMs": 30000 }
 *   ],
 *   "defaultServer": "local"
 * }
 */
export interface ComputeServerEntry {
	/** Unique human-readable key. Referenced by defaultServer. */
	label: string;
	serverUrl: string;
	apiKey?: string;
	/** Request timeout in ms. Default: 30000 */
	timeoutMs?: number;
	/** Retries on transient failure. Default: 0 */
	retryCount?: number;
}

export interface ComputeConfig {
	servers: ComputeServerEntry[];
	/** Label of the server to use when no routing rule matches. Falls back to servers[0]. */
	defaultServer?: string;
}
