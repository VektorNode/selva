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
	RequestContext,
	UserErasureOptions
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
 * Composition root for every local-provider data store. One
 * `LocalOrgStoreLoader` is shared across org + project stores so they see the
 * same cache and atomic write path; one `LocalUserDataStore` is shared across
 * the permissions, profile, and `ensureUser`/`onUserDeleted` paths so they
 * all read and write the same `user-data.json` row (the local equivalent of
 * Supabase's `handle_new_auth_user` trigger).
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
	readonly events?: IEventSink;

	private readonly userData: LocalUserDataStore;

	private constructor(
		stores: Omit<IDataProvider, 'ensureUser' | 'onUserDeleted'>,
		userData: LocalUserDataStore
	) {
		this.events = stores.events;
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
	 * Idempotently seeds a user's `user-data.json` row. Called on every authed
	 * request from `hooks.server.ts` — the local equivalent of Supabase's
	 * `handle_new_auth_user` trigger. `ctx` is unused; registration runs as a
	 * system operation regardless of the calling user, kept for interface
	 * symmetry with adapters that need it.
	 */
	async ensureUser(_ctx: RequestContext, userId: string): Promise<void> {
		await this.userData.ensure(userId);
	}

	/**
	 * Cascade hook run after the auth provider deletes a user: removes the
	 * `user-data.json` row and every live org membership, so the roster
	 * doesn't keep showing a bare user ID forever (Supabase gets this from FK
	 * constraints; local does it explicitly). Tolerates missing rows.
	 *
	 * `opts.email` is unused — the local provider has no audit_events or
	 * solve_metrics tables to scrub, and its invite set is small and
	 * operator-visible on disk.
	 */
	async onUserDeleted(
		ctx: RequestContext,
		userId: string,
		_opts?: UserErasureOptions
	): Promise<void> {
		try {
			await this.userData.deleteUser(userId);
		} catch {
			// Already absent — nothing to clean up.
		}
		// `findUserMembership` returns one live membership at a time; removing it
		// surfaces the next. 100 is far above any real org count — a ceiling in
		// case a store bug ever turns removal into a no-op.
		for (let i = 0; i < 100; i++) {
			const membership = await this.orgs.findUserMembership(ctx, userId);
			if (!membership) break;
			await this.orgs.removeOrgMember(ctx, membership.org.id, userId);
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
		// - definitions needs the project store for listPublic's visibility check
		// - shareLinks needs the definition store to enforce the soft-delete
		//   cascade on resolution, and both stores to walk link→definition→project
		//   for the org roster (Supabase does both via JOIN)
		// - projects needs the definition store to cascade soft-delete to a
		//   deleted project's definitions (Supabase does this inline)
		definitions.setProjectProvider(projects);
		shareLinks.setDefinitionProvider(definitions);
		shareLinks.setProjectProvider(projects);
		projects.setDefinitionProvider(definitions);

		const userData = createLocalUserDataStore(userDataFilePath);

		return new LocalDataProvider(
			{
				orgs,
				projects,
				definitions,
				computeServer,
				invites,
				shareLinks,
				userProfile: new LocalUserProfileProvider(userData),
				permissions: new LocalPlatformPermissionStore(userData),
				platformProjectGrants,
				events
			},
			userData
		);
	}
}
