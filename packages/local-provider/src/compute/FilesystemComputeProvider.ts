import * as fs from 'node:fs/promises';
import type {
	IComputeServerProvider,
	ComputeServerConfig,
	ComputeConfig,
	SolveRequest
} from '@selva/platform/compute';

/**
 * Compute provider that reads/writes compute.config.json.
 * The file is re-read on every getConfig/getServer call — changes take effect
 * immediately without restarting the server.
 */
export class FilesystemComputeProvider implements IComputeServerProvider {
	constructor(private readonly configFilePath: string) {}

	async getConfig(): Promise<ComputeConfig> {
		try {
			const raw = await fs.readFile(this.configFilePath, 'utf-8');
			return JSON.parse(raw) as ComputeConfig;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				return { servers: [] };
			}
			throw new Error(`Failed to read compute.config.json at "${this.configFilePath}": ${err}`);
		}
	}

	async saveConfig(config: ComputeConfig): Promise<void> {
		const tmp = `${this.configFilePath}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(config, null, '\t'), 'utf-8');
		await fs.rename(tmp, this.configFilePath);
	}

	async getDefaultServer(): Promise<ComputeServerConfig | undefined> {
		const config = await this.getConfig();
		if (config.defaultServerId) {
			const found = config.servers.find((s) => s.id === config.defaultServerId);
			if (found) return found;
		}
		return config.servers[0];
	}

	async getServerById(id: string): Promise<ComputeServerConfig | undefined> {
		const config = await this.getConfig();
		return config.servers.find((s) => s.id === id);
	}

	async getServer(_request?: SolveRequest): Promise<ComputeServerConfig> {
		const server = await this.getDefaultServer();
		if (!server) {
			throw new Error(
				`No compute servers configured in "${this.configFilePath}". ` +
					`Add at least one entry to the "servers" array.`
			);
		}
		return server;
	}
}
