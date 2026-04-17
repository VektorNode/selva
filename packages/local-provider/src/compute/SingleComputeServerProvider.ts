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

	async getServerById(id: string): Promise<ComputeServerConfig | undefined> {
		return this.server.id === id ? this.server : undefined;
	}

	async getConfig(): Promise<ComputeConfig> {
		return { servers: [this.server], defaultServerId: this.server.id };
	}

	async saveConfig(_config: ComputeConfig): Promise<void> {
		throw new Error('SingleComputeServerProvider does not support saveConfig — use FilesystemComputeProvider or another mutable provider.');
	}
}
