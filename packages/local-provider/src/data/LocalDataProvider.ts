import type {
	IDataProvider,
	IOrgStore,
	IProjectStore,
	IDefinitionStore,
	IComputeServerStore,
	IInviteStore
} from '@selva/platform';
import { LocalOrgStoreLoader, LocalOrganizationProvider } from '../organizations/LocalOrganizationProvider.js';
import { LocalProjectProvider } from '../projects/LocalProjectProvider.js';
import { LocalDefinitionMetaProvider } from '../definitions/LocalDefinitionMetaProvider.js';
import { LocalComputeServerProvider } from '../computeServer/LocalComputeServerProvider.js';
import { LocalInviteProvider } from '../invites/LocalInviteProvider.js';

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
			new LocalOrganizationProvider(loader),
			new LocalProjectProvider(loader),
			LocalDefinitionMetaProvider.fromEnv(env),
			LocalComputeServerProvider.fromEnv(env),
			LocalInviteProvider.fromEnv(env)
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
