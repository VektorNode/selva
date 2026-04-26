export interface ComputeServerConfig {
	id: string;
	/** `null` for instance-pool servers; an org id for BYO compute overrides. */
	orgId?: string | null;
	label: string;
	/** Base URL of the Rhino.Compute instance. */
	serverUrl: string;
	/** Sent as `RhinoComputeKey` header. */
	apiKey?: string;
	/** Default: 30000. */
	timeoutMs?: number;
	/** Default: 0. */
	retryCount?: number;
}

export interface ComputeConfig {
	servers: ComputeServerConfig[];
	/** Falls back to `servers[0]`. */
	defaultServerId?: string;
}
