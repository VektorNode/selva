import {
	isOrgServer,
	isPlatformServer,
	scopeConfigToOrg,
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
import { decryptWithKeys, encryptSecret, isEncryptedSecret } from '@selvajs/platform/computeServer';
import type { ClientBundle } from './client.js';
import { mapPostgrestError } from './errors.js';

// Sessions have no SELECT on `api_key`, so this list is all a session can read.
// Keys come from `readApiKeys`, after RLS has said which servers the caller sees.
const SERVER_COLUMNS =
	'id, scope, owner_org_id, shared_with_all, label, server_url, timeout_ms, retry_count, has_api_key';
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
	/** Current key first; the previous one still opens rows sealed before a rotation. */
	private readonly keys: Buffer[];

	constructor(
		private readonly clients: ClientBundle,
		private readonly secretKey?: Buffer,
		logger?: ILogger,
		previousKey?: Buffer
	) {
		this.logger = logger ?? new NoopLogger();
		this.keys = secretKey ? (previousKey ? [secretKey, previousKey] : [secretKey]) : [];
	}

	async getConfig(ctx: RequestContext, opts: GetConfigOptions = {}): Promise<ComputeConfig> {
		const client = this.clients.forRequest(ctx);
		const withKeys = opts.includeApiKeys === true;

		const [serversRes, sharesRes, orgDefRes, platDefRes] = await Promise.all([
			client.from('compute_servers').select(SERVER_COLUMNS),
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

		const rows: ServerRow[] = serversRes.data ?? [];
		const keyed = withKeys ? await this.withApiKeys(rows) : rows;
		const servers = keyed.map((row) => rowToServer(row, sharedByServer, withKeys));

		const orgDefaults: Record<string, string> = {};
		for (const row of orgDefRes.data ?? []) {
			if (row.default_server_id) orgDefaults[row.org_id] = row.default_server_id;
		}

		const config: ComputeConfig = {
			servers,
			defaultServerId: platDefRes.data?.default_server_id ?? undefined,
			orgDefaults
		};
		return opts.scopeToOrgId ? scopeConfigToOrg(config, opts.scopeToOrgId) : config;
	}

	/**
	 * The solve path's entry point: one row lookup + one decrypt instead of
	 * `getConfig`'s whole-table read. An unknown id or unreadable ciphertext
	 * yields `undefined` rather than throwing.
	 */
	async getServerApiKey(ctx: RequestContext, serverId: string): Promise<string | undefined> {
		const { data: visible, error: visibleError } = await this.clients
			.forRequest(ctx)
			.from('compute_servers')
			.select('id')
			.eq('id', serverId)
			.maybeSingle();
		if (visibleError) throw mapPostgrestError(visibleError);
		if (!visible) return undefined;

		const { data, error } = await this.clients.serviceClient
			.from('compute_servers')
			.select('id, label, api_key')
			.eq('id', serverId)
			.maybeSingle();
		if (error) throw mapPostgrestError(error);
		if (!data) return undefined;
		return this.decryptRowApiKey(data as ServerRow).api_key ?? undefined;
	}

	/** `rows` must come from a session read: this reaches keys with the service role. */
	private async withApiKeys(rows: ServerRow[]): Promise<ServerRow[]> {
		if (rows.length === 0) return rows;
		const { data, error } = await this.clients.serviceClient
			.from('compute_servers')
			.select('id, label, api_key')
			.in(
				'id',
				rows.map((r) => r.id)
			);
		if (error) throw mapPostgrestError(error);
		const keys = new Map((data ?? []).map((r) => [r.id as string, r.api_key as string | null]));
		return rows.map((row) => this.decryptRowApiKey({ ...row, api_key: keys.get(row.id) ?? null }));
	}

	async savePlatformServers(
		ctx: RequestContext,
		servers: ComputeServerConfig[],
		defaultServerId: string | undefined
	): Promise<void> {
		const platformOnly = servers.filter(isPlatformServer);
		const shares = platformOnly.flatMap((s) =>
			s.sharedWith === 'all'
				? []
				: s.sharedWith.map((orgId) => ({ server_id: s.id, org_id: orgId }))
		);
		const { error } = await this.clients.forRequest(ctx).rpc('save_platform_compute_servers', {
			servers: platformOnly.map((s) => serverToRow(this.encryptServerApiKey(s))),
			shares,
			default_server: defaultServerId ?? null
		});
		if (error) throw mapPostgrestError(error);
	}

	async saveOrgServers(
		ctx: RequestContext,
		orgId: string,
		servers: ComputeServerConfig[],
		defaultServerId?: string | null
	): Promise<void> {
		const orgOnly = servers.filter(isOrgServer).map((s) => ({ ...s, ownerOrgId: orgId }));
		const { error } = await this.clients.forRequest(ctx).rpc('save_org_compute_servers', {
			o: orgId,
			servers: orgOnly.map((s) => serverToRow(this.encryptServerApiKey(s))),
			set_default: defaultServerId !== undefined,
			default_server: defaultServerId ?? null
		});
		if (error) throw mapPostgrestError(error);
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
	 * Encrypt a server's `apiKey` before it is written to the DB, bound to its id.
	 * Throws on a value that is already an envelope, and if the store was built
	 * without a key, so we never silently persist plaintext.
	 */
	private encryptServerApiKey(s: ComputeServerConfig): ComputeServerConfig {
		if (!s.apiKey) return s;
		if (!this.secretKey) {
			throw new Error(
				'Cannot store a compute-server apiKey: SELVA_AT_REST_KEY is not configured. ' +
					'Set it so secrets are encrypted at rest.'
			);
		}
		return { ...s, apiKey: encryptSecret(s.apiKey, this.secretKey, s.id) };
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
			return { ...row, api_key: decryptWithKeys(row.api_key, this.keys, row.id).plaintext };
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
		let onPreviousKey = 0;

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
				if (decryptWithKeys(apiKey, this.keys, id).keyIndex > 0) onPreviousKey += 1;
			} catch (cause) {
				failures.push({
					serverId: id,
					serverLabel: label,
					reason: 'key_mismatch',
					cause: cause instanceof Error ? cause.message : String(cause)
				});
			}
		}

		return {
			ok: failures.length === 0,
			failures,
			plaintextFound,
			...(this.keys.length > 1 ? { onPreviousKey } : {})
		};
	}

	/**
	 * Re-seal under the current key every row only the previous key opens. The
	 * update matches on the old ciphertext too, so a row an admin re-saved in
	 * between is left alone rather than overwritten.
	 */
	async reencryptSecrets(): Promise<number> {
		if (this.keys.length < 2 || !this.secretKey) return 0;
		const { data, error } = await this.clients.serviceClient
			.from('compute_servers')
			.select('id, api_key');
		if (error) throw mapPostgrestError(error);
		let changed = 0;
		for (const row of (data ?? []) as { id: string; api_key: string | null }[]) {
			if (!row.api_key || !isEncryptedSecret(row.api_key)) continue;
			let opened: { plaintext: string; keyIndex: number };
			try {
				opened = decryptWithKeys(row.api_key, this.keys, row.id);
			} catch {
				continue;
			}
			if (opened.keyIndex === 0) continue;
			const { error: updateError, count } = await this.clients.serviceClient
				.from('compute_servers')
				.update(
					{ api_key: encryptSecret(opened.plaintext, this.secretKey, row.id) },
					{ count: 'exact' }
				)
				.eq('id', row.id)
				.eq('api_key', row.api_key);
			if (updateError) throw mapPostgrestError(updateError);
			changed += count ?? 0;
		}
		return changed;
	}
}

interface ServerRow {
	id: string;
	scope: 'platform' | 'org';
	owner_org_id: string | null;
	shared_with_all: boolean;
	label: string;
	server_url: string;
	/** Absent unless the row went through `withApiKeys`. */
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
