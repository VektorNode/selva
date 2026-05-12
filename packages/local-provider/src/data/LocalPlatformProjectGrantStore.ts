import * as path from 'node:path';
import type {
	IPlatformProjectGrantStore,
	PlatformProjectGrant,
	RequestContext
} from '@selvajs/platform';
import { ProviderError } from '@selvajs/platform';
import { readJsonFile, writeJsonFile } from './fsJson.js';

interface OnDiskShape {
	grants: PlatformProjectGrant[];
}

const empty = (): OnDiskShape => ({ grants: [] });

export class LocalPlatformProjectGrantStore implements IPlatformProjectGrantStore {
	private readonly filePath: string;

	static fromEnv(env: Record<string, string | undefined>): LocalPlatformProjectGrantStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalPlatformProjectGrantStore(
			path.join(env.DATA_PATH, 'platform-project-grants.json')
		);
	}

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	private async read(): Promise<OnDiskShape> {
		return readJsonFile<OnDiskShape>(this.filePath, empty());
	}

	private async write(data: OnDiskShape): Promise<void> {
		await writeJsonFile(this.filePath, data);
	}

	async listByProject(_ctx: RequestContext, projectId: string): Promise<PlatformProjectGrant[]> {
		const { grants } = await this.read();
		return grants.filter((g) => g.projectId === projectId);
	}

	async create(_ctx: RequestContext, grant: PlatformProjectGrant): Promise<void> {
		const data = await this.read();
		if (data.grants.some((g) => g.id === grant.id)) {
			throw new ProviderError(`Grant '${grant.id}' already exists`, 409);
		}
		const duplicate = data.grants.find(
			(g) =>
				g.projectId === grant.projectId &&
				g.granteeType === grant.granteeType &&
				g.granteeId === grant.granteeId
		);
		if (duplicate) {
			throw new ProviderError(
				`A grant for this ${grant.granteeType} already exists on this project`,
				409
			);
		}
		data.grants.push(grant);
		await this.write(data);
	}

	async delete(_ctx: RequestContext, id: string): Promise<void> {
		const data = await this.read();
		const idx = data.grants.findIndex((g) => g.id === id);
		if (idx === -1) throw new ProviderError(`Grant '${id}' not found`, 404);
		data.grants.splice(idx, 1);
		await this.write(data);
	}

	async deleteByProject(_ctx: RequestContext, projectId: string): Promise<void> {
		const data = await this.read();
		const before = data.grants.length;
		data.grants = data.grants.filter((g) => g.projectId !== projectId);
		if (data.grants.length !== before) await this.write(data);
	}

	async deleteByGranteeOrg(_ctx: RequestContext, orgId: string): Promise<void> {
		const data = await this.read();
		const before = data.grants.length;
		data.grants = data.grants.filter((g) => !(g.granteeType === 'org' && g.granteeId === orgId));
		if (data.grants.length !== before) await this.write(data);
	}
}
