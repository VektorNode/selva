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
	IEventSink,
	RequestContext
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
import { createLocalUserDataStore, type LocalUserDataStore } from './userData.js';

/**
 * Composition of every local-provider data store. One `LocalOrgStoreLoader`
 * is shared across org + project stores so they see the same cache and
 * atomic write path.
 *
 * The `LocalUserDataStore` is similarly shared across the permissions and
 * profile stores: both write to `user-data.json`, and `ensureUser` seeds
 * exactly the same row both stores read from. This is the local equivalent
 * of Supabase's `handle_new_auth_user` trigger.
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

	private readonly userData: LocalUserDataStore;

	private constructor(
		stores: Omit<IDataProvider, 'ensureUser' | 'onUserDeleted'>,
		userData: LocalUserDataStore
	) {
		this.orgs = stores.orgs;
		this.projects = stores.projects;
		this.definitions = stores.definitions;
		this.computeServer = stores.computeServer;
		this.invites = stores.invites;
		this.shareLinks = stores.shareLinks;
		this.userProfile = stores.userProfile;
		this.permissions = stores.permissions;
		this.platformProjectGrants = stores.platformProjectGrants;
		this.userData = userData;
	}

	/**
	 * Idempotently register a user in the data layer. Called from
	 * `hooks.server.ts` on every authed request — the local equivalent of
	 * Supabase's `handle_new_auth_user` trigger. After this completes the
	 * user has an empty row in `user-data.json` that the permissions and
	 * profile stores can read and update.
	 *
	 * `ctx` is unused — registration runs as a system operation regardless of
	 * the calling user. Argument is kept for interface symmetry with adapters
	 * that need it.
	 */
	async ensureUser(_ctx: RequestContext, userId: string): Promise<void> {
		await this.userData.ensure(userId);
	}

	/**
	 * Cascade hook called after the auth provider deletes a user. Removes the
	 * matching `user-data.json` row so the data layer doesn't accumulate
	 * orphans. Tolerates missing rows.
	 */
	async onUserDeleted(_ctx: RequestContext, userId: string): Promise<void> {
		try {
			await this.userData.deleteUser(userId);
		} catch {
			// Already absent — nothing to clean up.
		}
	}

	static fromEnv(
		env: Record<string, string | undefined>,
		events: IEventSink = new NoopEventSink()
	): LocalDataProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		const dataPath = env.DATA_PATH;
		const userDataFilePath = path.join(dataPath, 'user-data.json');

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

		const userData = createLocalUserDataStore(userDataFilePath);

		return new LocalDataProvider(
			{
				orgs,
				projects,
				definitions,
				computeServer,
				invites,
				shareLinks,
				userProfile: new LocalUserProfileProvider(userDataFilePath),
				permissions: new LocalPlatformPermissionStore(userDataFilePath),
				platformProjectGrants
			},
			userData
		);
	}
}
