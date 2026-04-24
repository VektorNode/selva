import * as path from 'node:path';
import type { IComputeServerStore, ComputeConfig, RequestContext } from '@selva/platform';
import { readJsonFile, writeJsonFile } from '../fsJson.js';

/**
 * Reads/writes compute.config.json.
 * The file is re-read on every getConfig() call — changes take effect
 * immediately without restarting the server.
 *
 * `ctx` is part of the contract but unused locally — there is no tenant
 * scope to enforce against the filesystem. A multi-tenant adapter would
 * authorize writes here.
 */
export class LocalComputeServerProvider implements IComputeServerStore {
	static fromEnv(env: Record<string, string | undefined>): LocalComputeServerProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalComputeServerProvider(path.join(env.DATA_PATH, 'compute.config.json'));
	}

	constructor(private readonly configFilePath: string) {}

	async getConfig(_ctx: RequestContext): Promise<ComputeConfig> {
		return readJsonFile<ComputeConfig>(this.configFilePath, { servers: [] });
	}

	async saveConfig(_ctx: RequestContext, config: ComputeConfig): Promise<void> {
		await writeJsonFile(this.configFilePath, config);
	}
}
