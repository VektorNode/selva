import type {
	IDataProvider,
	IOrgStore,
	IProjectStore,
	IDefinitionStore,
	IComputeServerStore,
	IInviteStore,
	IShareLinkStore,
	IUserProfileStore,
	IPlatformPermissionStore,
	IPlatformProjectGrantStore,
	IEventSink
} from '@selvajs/platform';
import { NoopEventSink } from '@selvajs/platform';
import * as path from 'node:path';
import { LocalOrgStore, LocalOrgStoreLoader } from './LocalOrgStore.js';
import { LocalProjectStore } from './LocalProjectStore.js';
import { LocalDefinitionStore } from './LocalDefinitionStore.js';
import { LocalComputeServerStore } from './LocalComputeServerStore.js';
import { LocalInviteStore } from './LocalInviteStore.js';
import { LocalShareLinkStore } from './LocalShareLinkStore.js';
import { LocalPlatformProjectGrantStore } from './LocalPlatformProjectGrantStore.js';
import { LocalUserProfileProvider } from '../userProfile/LocalUserProfileProvider.js';
import { LocalPlatformPermissionStore } from '../permissions/LocalPlatformPermissionStore.js';

/**
 * Composition of every local-provider data store. One `LocalOrgStoreLoader`
 * is shared across org + project stores so they see the same cache and
 * atomic write path.
 *
 * Stores are passed as a record so adding a new store doesn't ripple through
 * test fixtures and call sites.
 */
export class LocalDataProvider implements IDataProvider {
	readonly orgs: IOrgStore;
	readonly projects: IProjectStore;
	readonly definitions: IDefinitionStore;
	readonly computeServer: IComputeServerStore;
	readonly invites: IInviteStore;
	readonly shareLinks: IShareLinkStore;
	readonly userProfile: IUserProfileStore;
	readonly permissions: IPlatformPermissionStore;
	readonly platformProjectGrants: IPlatformProjectGrantStore;

	constructor(stores: IDataProvider) {
		this.orgs = stores.orgs;
		this.projects = stores.projects;
		this.definitions = stores.definitions;
		this.computeServer = stores.computeServer;
		this.invites = stores.invites;
		this.shareLinks = stores.shareLinks;
		this.userProfile = stores.userProfile;
		this.permissions = stores.permissions;
		this.platformProjectGrants = stores.platformProjectGrants;
	}

	static fromEnv(
		env: Record<string, string | undefined>,
		events: IEventSink = new NoopEventSink()
	): LocalDataProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		const dataPath = env.DATA_PATH;
		const usersFilePath = path.join(dataPath, 'users.json');

		const loader = new LocalOrgStoreLoader(dataPath);
		const platformProjectGrants = LocalPlatformProjectGrantStore.fromEnv(env);
		const invites = LocalInviteStore.fromEnv(env, events);
		const computeServer = LocalComputeServerStore.fromEnv(env);
		const projects = new LocalProjectStore({ loader, grants: platformProjectGrants, events });
		const definitions = new LocalDefinitionStore(dataPath, undefined, events);
		const shareLinks = new LocalShareLinkStore({
			filePath: path.join(dataPath, 'share-links.json'),
			events
		});
		const orgs = new LocalOrgStore({
			loader,
			invites,
			computeServer,
			grants: platformProjectGrants,
			events
		});

		// Wire cross-store deps that aren't constructor-injected:
		// - canEditDefinition needs the project store for `listPublic`
		// - share-link resolution needs the definition store to enforce the §7
		//   soft-delete cascade (Supabase does the equivalent via JOIN)
		definitions.setProjectProvider(projects);
		shareLinks.setDefinitionProvider(definitions);

		return new LocalDataProvider({
			orgs,
			projects,
			definitions,
			computeServer,
			invites,
			shareLinks,
			userProfile: new LocalUserProfileProvider(usersFilePath),
			permissions: new LocalPlatformPermissionStore(usersFilePath),
			platformProjectGrants
		});
	}
}
