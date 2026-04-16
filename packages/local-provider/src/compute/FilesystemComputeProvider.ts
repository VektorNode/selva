import * as fs from 'node:fs/promises';
import type {
	IComputeServerProvider,
	ComputeServerConfig,
	SolveRequest
} from '@selva/platform/compute';
import type { ComputeConfig } from './types.js';

/**
 * Compute server provider that reads from compute.config.json.
 *
 * Place compute.config.json in your definitions directory and set
 * COMPUTE_PROVIDER=filesystem. The file is read on every call —
 * changes take effect immediately without restarting the server.
 *
 * Example compute.config.json:
 * {
 *   "servers": [
 *     { "label": "local", "serverUrl": "http://localhost:5000", "timeoutMs": 30000 },
 *     { "label": "cloud", "serverUrl": "https://compute.example.com", "apiKey": "..." }
 *   ],
 *   "defaultServer": "local"
 * }
 */
export class FilesystemComputeProvider implements IComputeServerProvider {
	constructor(private readonly configFilePath: string) {}

	private async readConfig(): Promise<ComputeConfig> {
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

	async getServer(_request?: SolveRequest): Promise<ComputeServerConfig> {
		const config = await this.readConfig();

		if (config.servers.length === 0) {
			throw new Error(
				`No compute servers configured in "${this.configFilePath}". ` +
					`Add at least one entry to the "servers" array.`
			);
		}

		if (config.defaultServer) {
			const found = config.servers.find((s) => s.label === config.defaultServer);
			if (found) return found;
		}

		return config.servers[0];
	}

	async listServers(): Promise<ComputeServerConfig[]> {
		const config = await this.readConfig();
		return config.servers;
	}
}
