import type { IDataProvider } from '@selva/platform';
import type { ClientBundle, BuildClientOptions } from './client.js';
import { buildClientBundle } from './client.js';
import { SupabaseOrgStore } from './SupabaseOrgStore.js';
import { SupabaseProjectStore } from './SupabaseProjectStore.js';
import { SupabaseDefinitionStore } from './SupabaseDefinitionStore.js';
import { SupabaseInviteStore } from './SupabaseInviteStore.js';
import { SupabaseComputeServerStore } from './SupabaseComputeServerStore.js';

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

	private constructor(private readonly clients: ClientBundle) {
		this.orgs = new SupabaseOrgStore(clients);
		this.projects = new SupabaseProjectStore(clients);
		this.definitions = new SupabaseDefinitionStore(clients);
		this.invites = new SupabaseInviteStore(clients);
		this.computeServer = new SupabaseComputeServerStore(clients);
	}

	static fromEnv(env: Record<string, string | undefined>): SupabaseDataProvider {
		const supabaseUrl = env.SUPABASE_URL;
		const anonKey = env.SUPABASE_ANON_KEY;
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
		if (!anonKey) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
		if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
		return SupabaseDataProvider.create({ supabaseUrl, anonKey, serviceRoleKey });
	}

	static create(opts: BuildClientOptions): SupabaseDataProvider {
		return new SupabaseDataProvider(buildClientBundle(opts));
	}

	/**
	 * Expose the underlying bundle so other providers in the same package
	 * (storage, user profile, auth) can share one set of clients per process.
	 */
	getClientBundle(): ClientBundle {
		return this.clients;
	}
}
