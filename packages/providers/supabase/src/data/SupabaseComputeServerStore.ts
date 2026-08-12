import {
	isOrgServer,
	isPlatformServer,
	type IComputeServerStore,
	type ComputeConfig,
	type ComputeServerConfig,
	type GetConfigOptions,
	type RequestContext,
	type SecretVerificationFailure,
	type SecretVerificationReport,
	type ILogger
} from '@selvajs/platform';
import { NoopLogger } from '@selvajs/platform';
// `node:crypto`-based, so it's a server-only subpath, not the root barrel.
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@selvajs/platform/computeServer';
import type { ClientBundle } from './client.js';
import { mapPostgrestError } from './errors.js';

// Two separate literal column lists rather than one computed from a flag:
// supabase-js infers the row type from the literal string, so building it
// dynamically would degrade the type to `string`. The default list omits
// `api_key` — decrypting costs one call per row, and `getConfig` normally
// only needs to report whether a key is set.
const SERVER_COLUMNS =
	'id, scope, owner_org_id, shared_with_all, label, server_url, timeout_ms, retry_count, has_api_key';
const SERVER_COLUMNS_WITH_KEY =
	'id, scope, owner_org_id, shared_with_all, label, server_url, timeout_ms, retry_count, has_api_key, api_key';
const SHARE_COLUMNS = 'server_id, org_id';
const ORG_DEFAULT_COLUMNS = 'org_id, default_server_id';

/**
 * Compute-server config backed by three tables:
 *   - `compute_servers`: one row per server. `scope = 'platform' | 'org'`.
 *     Platform rows carry a `shared_with_all` flag + `compute_server_shares`
 *     allowlist; org rows carry `owner_org_id`.
 *   - `compute_server_shares`: many-to-many for platform servers shared
 *     with specific orgs (when `shared_with_all = false`).
 *   - `compute_server_org_defaults`: per-org `orgDefaults[orgId]` choice.
 *   - `compute_server_platform_default`: single-row sentinel for the global
 *     `defaultServerId`.
 *
 * `getConfig` returns the full doc; the visibility predicate is applied by
 * callers (resolver, page loaders) using helpers in `@selvajs/platform`.
 */
export class SupabaseComputeServerStore implements IComputeServerStore {
	/**
	 * `secretKey` (from `SELVA_AT_REST_KEY`) encrypts/decrypts `compute_servers.api_key`
	 * so the Rhino.Compute credential never sits in the DB as plaintext. Optional
	 * only for construction paths that never touch apiKeys — a store built
	 * without a key throws if asked to write or read a secret.
	 */
	private readonly logger: ILogger;

	constructor(
		private readonly clients: ClientBundle,
		private readonly secretKey?: Buffer,
		logger?: ILogger
	) {
		this.logger = logger ?? new NoopLogger();
	}

	async getConfig(ctx: RequestContext, opts: GetConfigOptions = {}): Promise<ComputeConfig> {
		const client = this.clients.forRequest(ctx);
		const withKeys = opts.includeApiKeys === true;

		const [serversRes, sharesRes, orgDefRes, platDefRes] = await Promise.all([
			withKeys
				? client.from('compute_servers').select(SERVER_COLUMNS_WITH_KEY)
				: client.from('compute_servers').select(SERVER_COLUMNS),
			client.from('compute_server_shares').select(SHARE_COLUMNS),
			client.from('compute_server_org_defaults').select(ORG_DEFAULT_COLUMNS),
			client
				.from('compute_server_platform_default')
				.select('default_server_id')
				.eq('singleton', true)
				.maybeSingle()
		]);

		if (serversRes.error) throw mapPostgrestError(serversRes.error);
		if (sharesRes.error) throw mapPostgrestError(sharesRes.error);
		if (orgDefRes.error) throw mapPostgrestError(orgDefRes.error);
		if (platDefRes.error) throw mapPostgrestError(platDefRes.error);

		const sharedByServer = new Map<string, string[]>();
		for (const row of sharesRes.data ?? []) {
			const list = sharedByServer.get(row.server_id) ?? [];
			list.push(row.org_id);
			sharedByServer.set(row.server_id, list);
		}

		const servers = (serversRes.data ?? []).map((row) =>
			rowToServer(withKeys ? this.decryptRowApiKey(row) : row, sharedByServer, withKeys)
		);

		const orgDefaults: Record<string, string> = {};
		for (const row of orgDefRes.data ?? []) {
			if (row.default_server_id) orgDefaults[row.org_id] = row.default_server_id;
		}

		return {
			servers,
			defaultServerId: platDefRes.data?.default_server_id ?? undefined,
			orgDefaults
		};
	}

	/**
	 * The solve path's entry point: one row lookup + one decrypt instead of
	 * `getConfig`'s whole-table read. An unknown id or unreadable ciphertext
	 * yields `undefined` rather than throwing.
	 */
	async getServerApiKey(ctx: RequestContext, serverId: string): Promise<string | undefined> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('compute_servers')
			.select('id, label, api_key')
			.eq('id', serverId)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		if (!data) return undefined;
		return this.decryptRowApiKey(data as ServerRow).api_key ?? undefined;
	}

	async savePlatformServers(
		ctx: RequestContext,
		servers: ComputeServerConfig[],
		defaultServerId: string | undefined
	): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const platformOnly = servers.filter(isPlatformServer);

		const { error: delErr } = await client.from('compute_servers').delete().eq('scope', 'platform');
		if (delErr) throw mapPostgrestError(delErr);

		if (platformOnly.length > 0) {
			const { error: insErr } = await client
				.from('compute_servers')
				.insert(platformOnly.map((s) => serverToRow(this.encryptServerApiKey(s))));
			if (insErr) throw mapPostgrestError(insErr);

			const shareRows = platformOnly.flatMap((s) =>
				s.sharedWith === 'all'
					? []
					: s.sharedWith.map((orgId) => ({ server_id: s.id, org_id: orgId }))
			);
			if (shareRows.length > 0) {
				const { error: shErr } = await client.from('compute_server_shares').insert(shareRows);
				if (shErr) throw mapPostgrestError(shErr);
			}
		}

		const { error: defErr } = await client
			.from('compute_server_platform_default')
			.update({ default_server_id: defaultServerId ?? null })
			.eq('singleton', true);
		if (defErr) throw mapPostgrestError(defErr);
	}

	async saveOrgServers(
		ctx: RequestContext,
		orgId: string,
		servers: ComputeServerConfig[],
		defaultServerId?: string | null
	): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const orgOnly = servers.filter(isOrgServer).map((s) => ({ ...s, ownerOrgId: orgId }));

		const { error: delErr } = await client
			.from('compute_servers')
			.delete()
			.eq('scope', 'org')
			.eq('owner_org_id', orgId);
		if (delErr) throw mapPostgrestError(delErr);

		if (orgOnly.length > 0) {
			const { error: insErr } = await client
				.from('compute_servers')
				.insert(orgOnly.map((s) => serverToRow(this.encryptServerApiKey(s))));
			if (insErr) throw mapPostgrestError(insErr);
		}

		if (defaultServerId === null) {
			const { error } = await client
				.from('compute_server_org_defaults')
				.delete()
				.eq('org_id', orgId);
			if (error) throw mapPostgrestError(error);
		} else if (typeof defaultServerId === 'string') {
			const { error } = await client
				.from('compute_server_org_defaults')
				.upsert({ org_id: orgId, default_server_id: defaultServerId });
			if (error) throw mapPostgrestError(error);
		}
	}

	async setOrgDefault(ctx: RequestContext, orgId: string, serverId: string | null): Promise<void> {
		const client = this.clients.forRequest(ctx);
		if (serverId === null) {
			const { error } = await client
				.from('compute_server_org_defaults')
				.delete()
				.eq('org_id', orgId);
			if (error) throw mapPostgrestError(error);
			return;
		}
		const { error } = await client
			.from('compute_server_org_defaults')
			.upsert({ org_id: orgId, default_server_id: serverId });
		if (error) throw mapPostgrestError(error);
	}

	async deleteByOrg(ctx: RequestContext, orgId: string): Promise<void> {
		const client = this.clients.forRequest(ctx);

		// Org soft-delete doesn't trigger the FK cascade from orgs(id), so
		// each dependent table needs an explicit delete here.
		const { error: defErr } = await client
			.from('compute_server_org_defaults')
			.delete()
			.eq('org_id', orgId);
		if (defErr) throw mapPostgrestError(defErr);

		const { error: srvErr } = await client
			.from('compute_servers')
			.delete()
			.eq('scope', 'org')
			.eq('owner_org_id', orgId);
		if (srvErr) throw mapPostgrestError(srvErr);

		const { error: shErr } = await client
			.from('compute_server_shares')
			.delete()
			.eq('org_id', orgId);
		if (shErr) throw mapPostgrestError(shErr);
	}

	// ==========================================================================
	// At-rest secret handling
	// ==========================================================================

	/**
	 * Encrypt a server's `apiKey` before it is written to the DB. Idempotent —
	 * an already-enveloped value is passed through, so a round-trip (read →
	 * save) never double-encrypts. Throws if the store was built without a key
	 * but a real secret needs writing, so we never silently persist plaintext.
	 */
	private encryptServerApiKey(s: ComputeServerConfig): ComputeServerConfig {
		if (!s.apiKey) return s;
		if (isEncryptedSecret(s.apiKey)) return s;
		if (!this.secretKey) {
			throw new Error(
				'Cannot store a compute-server apiKey: SELVA_AT_REST_KEY is not configured. ' +
					'Set it so secrets are encrypted at rest.'
			);
		}
		return { ...s, apiKey: encryptSecret(s.apiKey, this.secretKey) };
	}

	/**
	 * Decrypt a row's `api_key` on read. Tolerant, mirroring the local provider:
	 * a row whose ciphertext can't be authenticated under the current key is
	 * returned with `api_key: null` and a warning logged, so the page keeps
	 * rendering (solves against that server fail later at Rhino.Compute). A
	 * plaintext value that predates encryption is passed through unchanged and
	 * surfaced by `verifySecrets()` — never silently dropped.
	 */
	private decryptRowApiKey(row: ServerRow): ServerRow {
		if (!row.api_key) return row;
		if (!isEncryptedSecret(row.api_key)) {
			this.logger.warn(
				'Compute server row has a plaintext api_key; re-save it via /admin/compute so it is stored encrypted',
				{ component: 'selva', serverLabel: row.label, serverId: row.id }
			);
			return row;
		}
		if (!this.secretKey) {
			this.logger.warn(
				'Cannot decrypt api_key: SELVA_AT_REST_KEY is not configured. Returning without a key; solves will fail',
				{ component: 'selva', serverLabel: row.label, serverId: row.id }
			);
			return { ...row, api_key: null };
		}
		try {
			return { ...row, api_key: decryptSecret(row.api_key, this.secretKey) };
		} catch (cause) {
			this.logger.warn(
				'Could not decrypt api_key: the stored ciphertext does not match the current SELVA_AT_REST_KEY. ' +
					'This server is returned without an apiKey and solves against it will fail. ' +
					'Re-enter the key via /admin/compute, or restore the original SELVA_AT_REST_KEY',
				{
					component: 'selva',
					serverLabel: row.label,
					serverId: row.id,
					err: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
				}
			);
			return { ...row, api_key: null };
		}
	}

	/**
	 * Boot-time integrity check over every `compute_servers` row. Uses the
	 * service client (no request context at boot) to read raw ciphertext, then
	 * attempts to decrypt each `api_key`. Does NOT throw — returns a structured
	 * report for boot health to drive `/api/health`.
	 */
	async verifySecrets(): Promise<SecretVerificationReport> {
		const { data, error } = await this.clients.serviceClient
			.from('compute_servers')
			.select('id, label, api_key');
		if (error) throw mapPostgrestError(error);

		const failures: SecretVerificationFailure[] = [];
		let plaintextFound = false;

		for (const row of data ?? []) {
			const apiKey = (row as { api_key: string | null }).api_key;
			const id = (row as { id: string }).id;
			const label = (row as { label: string }).label;
			if (!apiKey) continue;
			if (!isEncryptedSecret(apiKey)) {
				plaintextFound = true;
				failures.push({ serverId: id, serverLabel: label, reason: 'plaintext_on_disk' });
				continue;
			}
			if (!this.secretKey) {
				failures.push({
					serverId: id,
					serverLabel: label,
					reason: 'key_mismatch',
					cause: 'SELVA_AT_REST_KEY is not configured'
				});
				continue;
			}
			try {
				decryptSecret(apiKey, this.secretKey);
			} catch (cause) {
				failures.push({
					serverId: id,
					serverLabel: label,
					reason: 'key_mismatch',
					cause: cause instanceof Error ? cause.message : String(cause)
				});
			}
		}

		return { ok: failures.length === 0, failures, plaintextFound };
	}
}

interface ServerRow {
	id: string;
	scope: 'platform' | 'org';
	owner_org_id: string | null;
	shared_with_all: boolean;
	label: string;
	server_url: string;
	/** Absent unless the row was read with `SERVER_COLUMNS_WITH_KEY`. */
	api_key?: string | null;
	/** Generated column — true when a key is stored, without reading it. */
	has_api_key?: boolean;
	timeout_ms: number | null;
	retry_count: number | null;
}

/**
 * `withKey` mirrors the projection the row was read with. It gates `apiKey`
 * explicitly rather than trusting the row's shape, so a key can never ride along
 * on a read that didn't ask for one.
 */
function rowToServer(
	row: ServerRow,
	sharedByServer: Map<string, string[]>,
	withKey: boolean
): ComputeServerConfig {
	const common = {
		id: row.id,
		label: row.label,
		serverUrl: row.server_url,
		apiKey: withKey ? (row.api_key ?? undefined) : undefined,
		// Prefer the generated column; fall back to the key itself for rows read
		// with the key-bearing projection on a DB predating the column.
		hasApiKey: row.has_api_key ?? !!row.api_key,
		timeoutMs: row.timeout_ms ?? undefined,
		retryCount: row.retry_count ?? undefined
	};
	if (row.scope === 'platform') {
		return {
			...common,
			scope: 'platform',
			sharedWith: row.shared_with_all ? 'all' : (sharedByServer.get(row.id) ?? [])
		};
	}
	if (!row.owner_org_id) {
		throw new Error(`compute_servers row ${row.id} has scope='org' but null owner_org_id`);
	}
	return { ...common, scope: 'org', ownerOrgId: row.owner_org_id };
}

/**
 * Insert shape. Deliberately not `ServerRow`: `has_api_key` is generated by the
 * database and rejected on write, so the writable columns are their own type.
 */
type ServerWriteRow = Omit<ServerRow, 'has_api_key'>;

function serverToRow(s: ComputeServerConfig): ServerWriteRow {
	const base = {
		id: s.id,
		label: s.label,
		server_url: s.serverUrl,
		api_key: s.apiKey ?? null,
		timeout_ms: s.timeoutMs ?? null,
		retry_count: s.retryCount ?? null
	};
	if (isPlatformServer(s)) {
		return {
			...base,
			scope: 'platform',
			owner_org_id: null,
			shared_with_all: s.sharedWith === 'all'
		};
	}
	return {
		...base,
		scope: 'org',
		owner_org_id: s.ownerOrgId,
		shared_with_all: false
	};
}
