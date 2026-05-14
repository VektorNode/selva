import {
	isOrgServer,
	isPlatformServer,
	type IComputeServerStore,
	type ComputeConfig,
	type ComputeServerConfig,
	type RequestContext
} from '@selvajs/platform';
import { ProviderError } from '@selvajs/platform';
import type { ClientBundle } from './client.js';

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
	constructor(private readonly clients: ClientBundle) {}

	async getConfig(ctx: RequestContext): Promise<ComputeConfig> {
		const client = this.clients.forRequest(ctx);

		const [serversRes, sharesRes, orgDefRes, platDefRes] = await Promise.all([
			client.from('compute_servers').select('*'),
			client.from('compute_server_shares').select('*'),
			client.from('compute_server_org_defaults').select('*'),
			client
				.from('compute_server_platform_default')
				.select('default_server_id')
				.eq('singleton', true)
				.maybeSingle()
		]);

		if (serversRes.error) throw mapError(serversRes.error);
		if (sharesRes.error) throw mapError(sharesRes.error);
		if (orgDefRes.error) throw mapError(orgDefRes.error);
		if (platDefRes.error) throw mapError(platDefRes.error);

		// Build per-server `sharedWith` allowlists from the join table.
		const sharedByServer = new Map<string, string[]>();
		for (const row of sharesRes.data ?? []) {
			const list = sharedByServer.get(row.server_id) ?? [];
			list.push(row.org_id);
			sharedByServer.set(row.server_id, list);
		}

		const servers = (serversRes.data ?? []).map((row) => rowToServer(row, sharedByServer));

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

	async savePlatformServers(
		ctx: RequestContext,
		servers: ComputeServerConfig[],
		defaultServerId: string | undefined
	): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const platformOnly = servers.filter(isPlatformServer);

		// Replace-all of platform rows.
		const { error: delErr } = await client.from('compute_servers').delete().eq('scope', 'platform');
		if (delErr) throw mapError(delErr);

		if (platformOnly.length > 0) {
			const { error: insErr } = await client
				.from('compute_servers')
				.insert(platformOnly.map(serverToRow));
			if (insErr) throw mapError(insErr);

			// Rebuild the share rows for any non-`all` platform servers.
			const shareRows = platformOnly.flatMap((s) =>
				s.sharedWith === 'all'
					? []
					: s.sharedWith.map((orgId) => ({ server_id: s.id, org_id: orgId }))
			);
			if (shareRows.length > 0) {
				const { error: shErr } = await client.from('compute_server_shares').insert(shareRows);
				if (shErr) throw mapError(shErr);
			}
		}

		const { error: defErr } = await client
			.from('compute_server_platform_default')
			.update({ default_server_id: defaultServerId ?? null })
			.eq('singleton', true);
		if (defErr) throw mapError(defErr);
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
		if (delErr) throw mapError(delErr);

		if (orgOnly.length > 0) {
			const { error: insErr } = await client
				.from('compute_servers')
				.insert(orgOnly.map(serverToRow));
			if (insErr) throw mapError(insErr);
		}

		if (defaultServerId === null) {
			const { error } = await client
				.from('compute_server_org_defaults')
				.delete()
				.eq('org_id', orgId);
			if (error) throw mapError(error);
		} else if (typeof defaultServerId === 'string') {
			const { error } = await client
				.from('compute_server_org_defaults')
				.upsert({ org_id: orgId, default_server_id: defaultServerId });
			if (error) throw mapError(error);
		}
	}

	async setOrgDefault(ctx: RequestContext, orgId: string, serverId: string | null): Promise<void> {
		const client = this.clients.forRequest(ctx);
		if (serverId === null) {
			const { error } = await client
				.from('compute_server_org_defaults')
				.delete()
				.eq('org_id', orgId);
			if (error) throw mapError(error);
			return;
		}
		const { error } = await client
			.from('compute_server_org_defaults')
			.upsert({ org_id: orgId, default_server_id: serverId });
		if (error) throw mapError(error);
	}

	async deleteByOrg(ctx: RequestContext, orgId: string): Promise<void> {
		const client = this.clients.forRequest(ctx);

		// orgDefaults entry — FK on org_id cascades from orgs(id), but org
		// soft-delete doesn't trigger the cascade, so do it explicitly.
		const { error: defErr } = await client
			.from('compute_server_org_defaults')
			.delete()
			.eq('org_id', orgId);
		if (defErr) throw mapError(defErr);

		// Org-private servers owned by this org.
		const { error: srvErr } = await client
			.from('compute_servers')
			.delete()
			.eq('scope', 'org')
			.eq('owner_org_id', orgId);
		if (srvErr) throw mapError(srvErr);

		// Strip this org from any platform server share allowlist.
		const { error: shErr } = await client
			.from('compute_server_shares')
			.delete()
			.eq('org_id', orgId);
		if (shErr) throw mapError(shErr);
	}
}

interface ServerRow {
	id: string;
	scope: 'platform' | 'org';
	owner_org_id: string | null;
	shared_with_all: boolean;
	label: string;
	server_url: string;
	api_key: string | null;
	timeout_ms: number | null;
	retry_count: number | null;
}

function rowToServer(row: ServerRow, sharedByServer: Map<string, string[]>): ComputeServerConfig {
	const common = {
		id: row.id,
		label: row.label,
		serverUrl: row.server_url,
		apiKey: row.api_key ?? undefined,
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

function serverToRow(s: ComputeServerConfig): ServerRow {
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

interface PostgrestError {
	code?: string;
	message?: string;
}

function mapError(e: unknown): Error {
	const pg = e as PostgrestError;
	if (pg?.code === '23505') return new ProviderError(pg.message ?? 'Duplicate record', 409);
	if (pg?.code === '23503') return new ProviderError(pg.message ?? 'Foreign key violation', 409);
	if (e instanceof Error) return e;
	if (e && typeof e === 'object') {
		const obj = e as { message?: string; code?: string };
		return new Error(obj.code ? `[${obj.code}] ${obj.message ?? ''}` : (obj.message ?? String(e)));
	}
	return new Error(String(e));
}
