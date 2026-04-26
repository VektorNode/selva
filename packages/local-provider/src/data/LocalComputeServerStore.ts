import * as path from 'node:path';
import type {
	IComputeServerStore,
	ComputeConfig,
	ComputeServerConfig,
	RequestContext
} from '@selvajs/platform';
import { readJsonFile, writeJsonFile } from './fsJson.js';

/**
 * On-disk file shape. One file holds both the instance pool (rows with
 * `orgId === null`) and per-org overrides (rows with `orgId === '<uuid>'`).
 *
 * `defaultServerId` is the instance-pool default. `orgDefaults[orgId]` is
 * each org's override default. Reads scope by `ctx.actingOrgId` and return
 * only the matching slice.
 */
interface OnDiskShape {
	servers: ComputeServerConfig[];
	defaultServerId?: string;
	orgDefaults?: Record<string, string>;
}

const EMPTY: OnDiskShape = { servers: [] };

/**
 * Reads/writes compute.config.json. The file is re-read on every `getConfig`
 * call so changes take effect without a restart.
 *
 * Spec §3 BYO compute: `ctx.actingOrgId` selects the scope.
 *   - `actingOrgId` set → returns servers/default for that org only.
 *   - `actingOrgId` unset → returns the instance pool only.
 *
 * Saving in a given scope replaces *only that scope's* rows; cross-scope
 * data is preserved untouched.
 */
export class LocalComputeServerStore implements IComputeServerStore {
	static fromEnv(env: Record<string, string | undefined>): LocalComputeServerStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalComputeServerStore(path.join(env.DATA_PATH, 'compute.config.json'));
	}

	constructor(private readonly configFilePath: string) {}

	private async readAll(): Promise<OnDiskShape> {
		const raw = await readJsonFile<OnDiskShape>(this.configFilePath, EMPTY);
		// Defensive: older files may lack orgDefaults.
		return { ...raw, orgDefaults: raw.orgDefaults ?? {} };
	}

	async getConfig(ctx: RequestContext): Promise<ComputeConfig> {
		const all = await this.readAll();
		const orgId = ctx.actingOrgId;

		if (orgId) {
			const servers = all.servers.filter((s) => s.orgId === orgId);
			const defaultServerId = all.orgDefaults?.[orgId];
			return { servers, defaultServerId };
		}

		const servers = all.servers.filter((s) => s.orgId == null);
		return { servers, defaultServerId: all.defaultServerId };
	}

	async saveConfig(ctx: RequestContext, config: ComputeConfig): Promise<void> {
		const all = await this.readAll();
		const orgId = ctx.actingOrgId;

		// Preserve other scopes' rows; replace only the scope we're saving.
		if (orgId) {
			const otherScopes = all.servers.filter((s) => s.orgId !== orgId);
			const orgServers = config.servers.map((s) => ({ ...s, orgId }));
			const orgDefaults = { ...(all.orgDefaults ?? {}) };
			if (config.defaultServerId) orgDefaults[orgId] = config.defaultServerId;
			else delete orgDefaults[orgId];

			await writeJsonFile<OnDiskShape>(this.configFilePath, {
				...all,
				servers: [...otherScopes, ...orgServers],
				orgDefaults
			});
			return;
		}

		const otherScopes = all.servers.filter((s) => s.orgId != null);
		const instanceServers = config.servers.map((s) => ({ ...s, orgId: null }));
		await writeJsonFile<OnDiskShape>(this.configFilePath, {
			...all,
			servers: [...instanceServers, ...otherScopes],
			defaultServerId: config.defaultServerId
		});
	}

	async deleteByOrg(_ctx: RequestContext, orgId: string): Promise<void> {
		const all = await this.readAll();
		const servers = all.servers.filter((s) => s.orgId !== orgId);
		const orgDefaults = { ...(all.orgDefaults ?? {}) };
		const hadDefault = orgId in orgDefaults;
		delete orgDefaults[orgId];
		if (servers.length === all.servers.length && !hadDefault) return;
		await writeJsonFile<OnDiskShape>(this.configFilePath, {
			...all,
			servers,
			orgDefaults
		});
	}
}
