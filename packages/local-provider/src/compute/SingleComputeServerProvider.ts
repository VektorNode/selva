import type {
	IComputeServerProvider,
	ComputeServerConfig,
	ComputeConfig,
	SolveRequest
} from '@selva/platform/compute';

/**
 * Default compute provider: always routes to the same server.
 * Configured by passing a ComputeServerConfig at construction time.
 */
export class SingleComputeServerProvider implements IComputeServerProvider {
	constructor(private readonly server: ComputeServerConfig) {}

	async getServer(_request?: SolveRequest): Promise<ComputeServerConfig> {
		return this.server;
	}

	async getDefaultServer(): Promise<ComputeServerConfig> {
		return this.server;
	}

	async getConfig(): Promise<ComputeConfig> {
		return { servers: [this.server], defaultServer: this.server.label };
	}

	async saveConfig(_config: ComputeConfig): Promise<void> {
		throw new Error('SingleComputeServerProvider does not support saveConfig — use FilesystemComputeProvider or another mutable provider.');
	}
}
