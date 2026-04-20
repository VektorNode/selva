import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IComputeServerStore, ComputeConfig } from '@selva/platform';

/**
 * Reads/writes compute.config.json.
 * The file is re-read on every getConfig() call — changes take effect
 * immediately without restarting the server.
 */
export class LocalComputeServerProvider implements IComputeServerStore {
	static fromEnv(env: Record<string, string | undefined>): LocalComputeServerProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalComputeServerProvider(path.join(env.DATA_PATH, 'compute.config.json'));
	}

	constructor(private readonly configFilePath: string) {}

	async getConfig(): Promise<ComputeConfig> {
		try {
			const raw = await fs.readFile(this.configFilePath, 'utf-8');
			return JSON.parse(raw) as ComputeConfig;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { servers: [] };
			throw new Error(`Failed to read compute.config.json at "${this.configFilePath}": ${err}`);
		}
	}

	async saveConfig(config: ComputeConfig): Promise<void> {
		const tmp = `${this.configFilePath}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(config, null, '\t'), 'utf-8');
		await fs.rename(tmp, this.configFilePath);
	}
}
