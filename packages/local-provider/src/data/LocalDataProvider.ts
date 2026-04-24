import type {
	IDataProvider,
	IOrgStore,
	IProjectStore,
	IDefinitionStore,
	IComputeServerStore,
	IInviteStore
} from '@selva/platform';
import { LocalOrgStore, LocalOrgStoreLoader } from './LocalOrgStore.js';
import { LocalProjectStore } from './LocalProjectStore.js';
import { LocalDefinitionStore } from './LocalDefinitionStore.js';
import { LocalComputeServerStore } from './LocalComputeServerStore.js';
import { LocalInviteStore } from './LocalInviteStore.js';

/**
 * Composition of every local-provider data store. One `LocalOrgStoreLoader`
 * is shared across org + project stores so they see the same cache and
 * atomic write path.
 */
export class LocalDataProvider implements IDataProvider {
	readonly orgs: IOrgStore;
	readonly projects: IProjectStore;
	readonly definitions: IDefinitionStore;
	readonly computeServer: IComputeServerStore;
	readonly invites: IInviteStore;

	static fromEnv(env: Record<string, string | undefined>): LocalDataProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		const loader = new LocalOrgStoreLoader(env.DATA_PATH);
		return new LocalDataProvider(
			new LocalOrgStore(loader),
			new LocalProjectStore(loader),
			LocalDefinitionStore.fromEnv(env),
			LocalComputeServerStore.fromEnv(env),
			LocalInviteStore.fromEnv(env)
		);
	}

	constructor(
		orgs: IOrgStore,
		projects: IProjectStore,
		definitions: IDefinitionStore,
		computeServer: IComputeServerStore,
		invites: IInviteStore
	) {
		this.orgs = orgs;
		this.projects = projects;
		this.definitions = definitions;
		this.computeServer = computeServer;
		this.invites = invites;
	}
}
