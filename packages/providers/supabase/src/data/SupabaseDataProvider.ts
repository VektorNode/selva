import type { IDataProvider, IEventSink, IPlatformProjectGrantStore } from '@selvajs/platform';
import { ProviderError } from '@selvajs/platform';
import type { ClientBundle, BuildClientOptions } from './client.js';
import { buildClientBundle } from './client.js';
import { SupabaseEventSink } from './SupabaseEventSink.js';
import { SupabaseSolveMetricSink } from './SupabaseSolveMetricSink.js';
import { SupabaseAuditQuery } from './SupabaseAuditQuery.js';
import { SupabaseOrgStore } from './SupabaseOrgStore.js';
import { SupabaseProjectStore } from './SupabaseProjectStore.js';
import { SupabaseDefinitionStore } from './SupabaseDefinitionStore.js';
import { SupabaseInviteStore } from './SupabaseInviteStore.js';
import { SupabaseComputeServerStore } from './SupabaseComputeServerStore.js';
import { SupabaseShareLinkStore } from './SupabaseShareLinkStore.js';
import { SupabaseUserProfileProvider } from '../userProfile/SupabaseUserProfileProvider.js';
import { SupabasePlatformPermissionStore } from '../permissions/SupabasePlatformPermissionStore.js';

/**
 * Stub until the Supabase implementation lands. Reads and mutations surface a
 * clear 501; cascade hooks are silent no-ops so deleting an org or project on
 * a Supabase deployment without the feature wired does not blow up.
 */
const NOT_IMPLEMENTED_MSG = 'Platform projects are not supported on this deployment yet.';
const notImplementedGrantStore: IPlatformProjectGrantStore = {
	listByProject: async () => {
		throw new ProviderError(NOT_IMPLEMENTED_MSG, 501);
	},
	create: async () => {
		throw new ProviderError(NOT_IMPLEMENTED_MSG, 501);
	},
	delete: async () => {
		throw new ProviderError(NOT_IMPLEMENTED_MSG, 501);
	},
	deleteByProject: async () => {
		// No-op: nothing to clean up on a deployment that never accepted grants.
	},
	deleteByGranteeOrg: async () => {
		// No-op: same reasoning.
	}
};

/**
 * Composition of every data store for the Supabase backend. Instantiates one
 * `ClientBundle` (service-role + per-request factory) and wires each store
 * against it so every store in a single process shares the same pooled clients.
 */
export class SupabaseDataProvider implements IDataProvider {
	readonly orgs: SupabaseOrgStore;
	readonly projects: SupabaseProjectStore;
	readonly definitions: SupabaseDefinitionStore;
	readonly invites: SupabaseInviteStore;
	readonly computeServer: SupabaseComputeServerStore;
	readonly shareLinks: SupabaseShareLinkStore;
	readonly userProfile: SupabaseUserProfileProvider;
	readonly permissions: SupabasePlatformPermissionStore;
	readonly platformProjectGrants: IPlatformProjectGrantStore;
	readonly auditQuery: SupabaseAuditQuery;
	/**
	 * Per-solve timing sink, built from the same client bundle. Exposed so the
	 * app's provider wiring can hand it to `SelvaConfig.solveMetrics` without
	 * constructing a second Supabase client.
	 */
	readonly solveMetrics: SupabaseSolveMetricSink;

	private constructor(
		private readonly clients: ClientBundle,
		events: IEventSink
	) {
		this.solveMetrics = new SupabaseSolveMetricSink(clients);
		this.orgs = new SupabaseOrgStore(clients, events);
		this.projects = new SupabaseProjectStore(clients, events);
		this.definitions = new SupabaseDefinitionStore(clients, events);
		this.invites = new SupabaseInviteStore(clients, events);
		this.computeServer = new SupabaseComputeServerStore(clients);
		this.shareLinks = new SupabaseShareLinkStore(clients, events);
		this.userProfile = new SupabaseUserProfileProvider(clients);
		this.permissions = new SupabasePlatformPermissionStore(clients);
		this.platformProjectGrants = notImplementedGrantStore;
		this.auditQuery = new SupabaseAuditQuery(clients);
	}

	static fromEnv(
		env: Record<string, string | undefined>,
		events?: IEventSink
	): SupabaseDataProvider {
		const supabaseUrl = env.SUPABASE_URL;
		const anonKey = env.SUPABASE_ANON_KEY;
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
		if (!anonKey) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
		if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
		const bundle = buildClientBundle({ supabaseUrl, anonKey, serviceRoleKey });
		return new SupabaseDataProvider(bundle, events ?? new SupabaseEventSink(bundle));
	}

	static create(opts: BuildClientOptions, events?: IEventSink): SupabaseDataProvider {
		const bundle = buildClientBundle(opts);
		return new SupabaseDataProvider(bundle, events ?? new SupabaseEventSink(bundle));
	}

	/**
	 * Build from a pre-existing `ClientBundle`. Useful for tests or advanced
	 * cases that need to inject a custom event sink or share a bundle externally.
	 */
	static fromBundle(bundle: ClientBundle, events?: IEventSink): SupabaseDataProvider {
		return new SupabaseDataProvider(bundle, events ?? new SupabaseEventSink(bundle));
	}

	/**
	 * Expose the underlying bundle so other providers in the same package
	 * (storage, user profile, auth) can share one set of clients per process.
	 */
	getClientBundle(): ClientBundle {
		return this.clients;
	}

	/**
	 * No-op: `public.user_profiles` is auto-seeded by the `handle_new_auth_user`
	 * trigger on every `auth.users` insert (see `0001_initial.sql`). The data
	 * layer always has a row for any authenticated user without per-request work.
	 */
	async ensureUser(): Promise<void> {
		// Trigger handles it.
	}

	/**
	 * No-op: `public.user_profiles.user_id` references `auth.users(id)` with
	 * `on delete cascade`. Deleting the auth user removes the profile row
	 * automatically.
	 */
	async onUserDeleted(): Promise<void> {
		// FK cascade handles it.
	}
}
