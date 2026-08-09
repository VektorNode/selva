import type {
	IDataProvider,
	IEventSink,
	IPlatformProjectGrantStore,
	RequestContext,
	SchemaVersionReport,
	UserErasureOptions
} from '@selvajs/platform';
import { ERASED_ACTOR_ID, NoopLogger, ProviderError, type ILogger } from '@selvajs/platform';
import { decodeSecretKey } from '@selvajs/platform/computeServer';
import { EXPECTED_MIGRATION_HEAD } from './migrationHead.js';
import type { ClientBundle, BuildClientOptions } from './client.js';
import { buildClientBundle, clientBundleFromEnv } from './client.js';
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
 * Stub until the Supabase implementation lands. Reads and mutations throw a
 * 501; cascade hooks are silent no-ops so deleting an org or project doesn't
 * blow up on a deployment without the feature wired.
 */
const NOT_IMPLEMENTED_MSG = 'Platform projects are not supported on this deployment yet.';
const notImplementedGrantStore: IPlatformProjectGrantStore = {
	listByProject: async () => {
		throw new ProviderError(NOT_IMPLEMENTED_MSG, 501);
	},
	listByProjects: async () => {
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
 * Composition of every data store for the Supabase backend. Builds one
 * `ClientBundle` and wires every store to it, so all stores in a process
 * share the same pooled clients.
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
	readonly events: IEventSink;
	/** Built from the same client bundle so wiring `SelvaConfig.solveMetrics` doesn't need a second Supabase client. */
	readonly solveMetrics: SupabaseSolveMetricSink;

	private constructor(
		private readonly clients: ClientBundle,
		events: IEventSink,
		secretKey?: Buffer,
		logger: ILogger = new NoopLogger()
	) {
		this.events = events;
		this.solveMetrics = new SupabaseSolveMetricSink(clients, { logger });
		this.orgs = new SupabaseOrgStore(clients, events);
		this.projects = new SupabaseProjectStore(clients, events);
		this.definitions = new SupabaseDefinitionStore(clients, events);
		this.invites = new SupabaseInviteStore(clients, events);
		this.computeServer = new SupabaseComputeServerStore(clients, secretKey, logger);
		this.shareLinks = new SupabaseShareLinkStore(clients, events);
		this.userProfile = new SupabaseUserProfileProvider(clients);
		this.permissions = new SupabasePlatformPermissionStore(clients);
		this.platformProjectGrants = notImplementedGrantStore;
		this.auditQuery = new SupabaseAuditQuery(clients);
	}

	static fromEnv(
		env: Record<string, string | undefined>,
		events?: IEventSink,
		logger: ILogger = new NoopLogger()
	): SupabaseDataProvider {
		const bundle = clientBundleFromEnv(env);
		// Same encryption-at-rest guarantee as the local provider's on-disk envelope.
		if (!env.SELVA_AT_REST_KEY) {
			throw new Error(
				'Missing required env var: SELVA_AT_REST_KEY (32-byte hex or base64). ' +
					'Required to encrypt compute-server API keys at rest. ' +
					"Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
			);
		}
		const secretKey = decodeSecretKey(env.SELVA_AT_REST_KEY);
		return new SupabaseDataProvider(
			bundle,
			events ?? new SupabaseEventSink(bundle, { logger }),
			secretKey,
			logger
		);
	}

	static create(
		opts: BuildClientOptions,
		events?: IEventSink,
		secretKey?: Buffer,
		logger: ILogger = new NoopLogger()
	): SupabaseDataProvider {
		const bundle = buildClientBundle(opts);
		return new SupabaseDataProvider(
			bundle,
			events ?? new SupabaseEventSink(bundle, { logger }),
			secretKey,
			logger
		);
	}

	/**
	 * Build from a pre-existing `ClientBundle` — for tests or callers that need
	 * to inject a custom event sink or share a bundle externally. Omit
	 * `secretKey` only if the caller never touches compute-server apiKeys:
	 * writes without a key throw rather than persist plaintext.
	 */
	static fromBundle(
		bundle: ClientBundle,
		events?: IEventSink,
		secretKey?: Buffer,
		logger: ILogger = new NoopLogger()
	): SupabaseDataProvider {
		return new SupabaseDataProvider(
			bundle,
			events ?? new SupabaseEventSink(bundle, { logger }),
			secretKey,
			logger
		);
	}

	/** Lets other providers in this package (storage, user profile, auth) share one set of clients per process. */
	getClientBundle(): ClientBundle {
		return this.clients;
	}

	/**
	 * Calls `selva.migration_head()` (a SECURITY DEFINER RPC shipped in this
	 * package's migrations) and compares it to the head this build expects.
	 * Three failure shapes: the RPC is missing (handshake migration never
	 * applied), the head is empty (no migrations pushed), or the head is
	 * lexicographically behind (operator upgraded the app but skipped
	 * `supabase db push`). Never throws — boot health consumes the report.
	 */
	async verifySchemaVersion(): Promise<SchemaVersionReport> {
		const expected = EXPECTED_MIGRATION_HEAD;
		const pushHint =
			'Apply the pending Supabase migrations: sync them into your project ' +
			'(see @selvajs/supabase-provider sync-migrations) and run `npx supabase db push`.';
		try {
			const { data, error } = await this.clients.serviceClient.rpc('migration_head');
			if (error) {
				return {
					ok: false,
					expected,
					actual: null,
					message:
						`selva.migration_head() is not available (${error.message ?? error.code ?? 'unknown error'}) ` +
						`— the database schema is behind this app version. ${pushHint}`
				};
			}
			const actual = typeof data === 'string' ? data : '';
			if (!actual) {
				return {
					ok: false,
					expected,
					actual: '',
					message: `The database reports no applied migrations. ${pushHint}`
				};
			}
			// Timestamp prefixes are fixed-width, so string comparison is chronological.
			// A head ahead of the app (rolled-back app, newer DB) is tolerated — schema
			// changes are append-only by convention.
			const ok = actual >= expected;
			return {
				ok,
				expected,
				actual,
				message: ok
					? undefined
					: `Database migration head ${actual} is behind the app's expected ${expected}. ${pushHint}`
			};
		} catch (err) {
			return {
				ok: false,
				expected,
				actual: null,
				message: `Schema handshake failed: ${err instanceof Error ? err.message : String(err)}`
			};
		}
	}

	/** No-op: the `handle_new_auth_user` trigger seeds `user_profiles` on every `auth.users` insert. */
	async ensureUser(): Promise<void> {
		// no-op
	}

	/**
	 * FK cascade against `auth.users` already removes the profile, memberships,
	 * and owned rows. Three classes of personal data aren't reachable by those
	 * FKs and get scrubbed here explicitly, with the RLS-bypassing service client:
	 *
	 *  1. `audit_events` keyed by a plain-text `actor_id` (no FK) — deleted.
	 *  2. The user's email in `invites.email` and in `invite.created` audit
	 *     payloads (`data->>'email'`). Invite rows are deleted; the audit email
	 *     is redacted in place — the fact that an invite was created stays, only
	 *     the PII goes.
	 *  3. `solve_metrics.actor_id`, deliberately not FK-cascaded (retention
	 *     telemetry) — tombstoned to {@link ERASED_ACTOR_ID} so the row's
	 *     aggregate value survives without identifying the person.
	 *
	 * Each step tolerates missing rows, so retrying is safe. Email scrubs are
	 * skipped when `opts.email` is absent — the caller must capture it before
	 * `deleteUser`.
	 */
	async onUserDeleted(
		_ctx: RequestContext,
		userId: string,
		opts?: UserErasureOptions
	): Promise<void> {
		const client = this.clients.serviceClient;
		const email = opts?.email;

		const deletedActions = await client.from('audit_events').delete().eq('actor_id', userId);
		if (deletedActions.error) {
			throw new ProviderError(
				`Failed to erase audit_events for user: ${deletedActions.error.message}`,
				500
			);
		}

		const tombstoned = await client
			.from('solve_metrics')
			.update({ actor_id: ERASED_ACTOR_ID })
			.eq('actor_id', userId);
		if (tombstoned.error) {
			throw new ProviderError(
				`Failed to anonymize solve_metrics for user: ${tombstoned.error.message}`,
				500
			);
		}

		if (!email) return;

		// `invited_by` FK cascade only removes invites this user SENT, not ones addressed to them.
		const deletedInvites = await client.from('invites').delete().eq('email', email);
		if (deletedInvites.error) {
			throw new ProviderError(
				`Failed to erase invites for user email: ${deletedInvites.error.message}`,
				500
			);
		}

		const redacted = await client.rpc('redact_audit_event_email', { p_email: email });
		if (redacted.error) {
			throw new ProviderError(
				`Failed to redact audit_events email payloads: ${redacted.error.message}`,
				500
			);
		}
	}
}
