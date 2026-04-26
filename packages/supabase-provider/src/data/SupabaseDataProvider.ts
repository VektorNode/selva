import type { IDataProvider, IEventSink } from '@selva/platform';
import { NoopEventSink } from '@selva/platform';
import type { ClientBundle, BuildClientOptions } from './client.js';
import { buildClientBundle } from './client.js';
import { SupabaseOrgStore } from './SupabaseOrgStore.js';
import { SupabaseProjectStore } from './SupabaseProjectStore.js';
import { SupabaseDefinitionStore } from './SupabaseDefinitionStore.js';
import { SupabaseInviteStore } from './SupabaseInviteStore.js';
import { SupabaseComputeServerStore } from './SupabaseComputeServerStore.js';
import { SupabaseShareLinkStore } from './SupabaseShareLinkStore.js';

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

	private constructor(private readonly clients: ClientBundle, events: IEventSink) {
		this.orgs = new SupabaseOrgStore(clients, events);
		this.projects = new SupabaseProjectStore(clients, events);
		this.definitions = new SupabaseDefinitionStore(clients, events);
		this.invites = new SupabaseInviteStore(clients, events);
		this.computeServer = new SupabaseComputeServerStore(clients);
		this.shareLinks = new SupabaseShareLinkStore(clients, events);
	}

	static fromEnv(
		env: Record<string, string | undefined>,
		events: IEventSink = new NoopEventSink()
	): SupabaseDataProvider {
		const supabaseUrl = env.SUPABASE_URL;
		const anonKey = env.SUPABASE_ANON_KEY;
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
		if (!anonKey) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
		if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
		return SupabaseDataProvider.create({ supabaseUrl, anonKey, serviceRoleKey }, events);
	}

	static create(
		opts: BuildClientOptions,
		events: IEventSink = new NoopEventSink()
	): SupabaseDataProvider {
		return new SupabaseDataProvider(buildClientBundle(opts), events);
	}

	/**
	 * Build from a pre-existing `ClientBundle`. Used when the caller wants to
	 * share one bundle across the data provider AND a sink that writes through
	 * the same service-role client (e.g., `SupabaseEventSink`).
	 */
	static fromBundle(
		bundle: ClientBundle,
		events: IEventSink = new NoopEventSink()
	): SupabaseDataProvider {
		return new SupabaseDataProvider(bundle, events);
	}

	/**
	 * Expose the underlying bundle so other providers in the same package
	 * (storage, user profile, auth) can share one set of clients per process.
	 */
	getClientBundle(): ClientBundle {
		return this.clients;
	}
}
