import type {
	IComputeServerProvider,
	ComputeServerConfig,
	SolveRequest
} from '@selva/platform/compute';

/**
 * Default compute server provider: always routes to the same server.
 * Configured by passing a ComputeServerConfig at construction time.
 *
 * Used when COMPUTE_PROVIDER=single (the default).
 */
export class SingleComputeServerProvider implements IComputeServerProvider {
	constructor(private readonly config: ComputeServerConfig) {}

	async getServer(_request?: SolveRequest): Promise<ComputeServerConfig> {
		return this.config;
	}

	async listServers(): Promise<ComputeServerConfig[]> {
		return [this.config];
	}
}
