import type { IDataProvider, IEventSink } from '@selvajs/platform';
import type { ClientBundle, BuildClientOptions } from './client.js';
import { buildClientBundle } from './client.js';
import { SupabaseEventSink } from './SupabaseEventSink.js';
import { SupabaseOrgStore } from './SupabaseOrgStore.js';
import { SupabaseProjectStore } from './SupabaseProjectStore.js';
import { SupabaseDefinitionStore } from './SupabaseDefinitionStore.js';
import { SupabaseInviteStore } from './SupabaseInviteStore.js';
import { SupabaseComputeServerStore } from './SupabaseComputeServerStore.js';
import { SupabaseShareLinkStore } from './SupabaseShareLinkStore.js';
import { SupabaseUserProfileProvider } from '../userProfile/SupabaseUserProfileProvider.js';
import { SupabasePlatformPermissionStore } from '../permissions/SupabasePlatformPermissionStore.js';

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

	private constructor(
		private readonly clients: ClientBundle,
		events: IEventSink
	) {
		this.orgs = new SupabaseOrgStore(clients, events);
		this.projects = new SupabaseProjectStore(clients, events);
		this.definitions = new SupabaseDefinitionStore(clients, events);
		this.invites = new SupabaseInviteStore(clients, events);
		this.computeServer = new SupabaseComputeServerStore(clients);
		this.shareLinks = new SupabaseShareLinkStore(clients, events);
		this.userProfile = new SupabaseUserProfileProvider(clients);
		this.permissions = new SupabasePlatformPermissionStore(clients);
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

	static create(
		opts: BuildClientOptions,
		events?: IEventSink
	): SupabaseDataProvider {
		const bundle = buildClientBundle(opts);
		return new SupabaseDataProvider(bundle, events ?? new SupabaseEventSink(bundle));
	}

	/**
	 * Build from a pre-existing `ClientBundle`. Useful for tests or advanced
	 * cases that need to inject a custom event sink or share a bundle externally.
	 */
	static fromBundle(
		bundle: ClientBundle,
		events?: IEventSink
	): SupabaseDataProvider {
		return new SupabaseDataProvider(bundle, events ?? new SupabaseEventSink(bundle));
	}

	/**
	 * Expose the underlying bundle so other providers in the same package
	 * (storage, user profile, auth) can share one set of clients per process.
	 */
	getClientBundle(): ClientBundle {
		return this.clients;
	}
}
