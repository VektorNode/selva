import type {
	IDataProvider,
	IOrgStore,
	IProjectStore,
	IDefinitionStore,
	IComputeServerStore,
	IInviteStore,
	IShareLinkStore
} from '@selva/platform';
import { LocalOrgStore, LocalOrgStoreLoader } from './LocalOrgStore.js';
import { LocalProjectStore } from './LocalProjectStore.js';
import { LocalDefinitionStore } from './LocalDefinitionStore.js';
import { LocalComputeServerStore } from './LocalComputeServerStore.js';
import { LocalInviteStore } from './LocalInviteStore.js';
import { LocalShareLinkStore } from './LocalShareLinkStore.js';

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
	readonly shareLinks: IShareLinkStore;

	static fromEnv(env: Record<string, string | undefined>): LocalDataProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		const loader = new LocalOrgStoreLoader(env.DATA_PATH);
		const projects = new LocalProjectStore(loader);
		const definitions = LocalDefinitionStore.fromEnv(env);
		const shareLinks = LocalShareLinkStore.fromEnv(env);
		// Wire cross-store deps: canEditDefinition needs the project store, and
		// share-link resolution needs the definition store to enforce the §7
		// soft-delete cascade (Supabase does the equivalent via JOIN).
		definitions.setProjectProvider(projects);
		shareLinks.setDefinitionProvider(definitions);
		return new LocalDataProvider(
			new LocalOrgStore(loader),
			projects,
			definitions,
			LocalComputeServerStore.fromEnv(env),
			LocalInviteStore.fromEnv(env),
			shareLinks
		);
	}

	constructor(
		orgs: IOrgStore,
		projects: IProjectStore,
		definitions: IDefinitionStore,
		computeServer: IComputeServerStore,
		invites: IInviteStore,
		shareLinks: IShareLinkStore
	) {
		this.orgs = orgs;
		this.projects = projects;
		this.definitions = definitions;
		this.computeServer = computeServer;
		this.invites = invites;
		this.shareLinks = shareLinks;
	}
}
