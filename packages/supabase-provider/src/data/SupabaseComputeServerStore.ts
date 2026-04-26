import type {
	IComputeServerStore,
	ComputeConfig,
	ComputeServerConfig,
	RequestContext
} from '@selva/platform';
import { ProviderError } from '@selva/platform';
import type { ClientBundle } from './client.js';

/**
 * Compute-server config backed by three tables:
 *   - `compute_servers`: one row per configured Rhino.Compute instance.
 *     `org_id NULL` = platform-wide (cross-org) entry.
 *   - `compute_server_defaults`: per-org default selection.
 *   - `compute_server_platform_default`: single-row sentinel for the
 *     platform-wide default (Postgres can't use NULL in a PK, so we
 *     use a boolean singleton).
 *
 * `getConfig` / `saveConfig` take a `RequestContext`. If `ctx.actingOrgId` is
 * set, we scope to that org; otherwise we return the platform-wide view.
 * Matches what the local provider does today.
 *
 * `saveConfig` replaces the entire server list for the active scope.
 * Simplest correct behavior — compute-server config is admin-edited and
 * rare, atomic-ness is not worth a transaction RPC.
 */
export class SupabaseComputeServerStore implements IComputeServerStore {
	constructor(private readonly clients: ClientBundle) {}

	async getConfig(ctx: RequestContext): Promise<ComputeConfig> {
		const client = this.clients.forRequest(ctx);
		const orgId = ctx.actingOrgId ?? null;

		const serversQuery = orgId
			? client.from('compute_servers').select('*').eq('org_id', orgId)
			: client.from('compute_servers').select('*').is('org_id', null);

		const { data: servers, error: serversError } = await serversQuery;
		if (serversError) throw mapError(serversError);

		let defaultServerId: string | undefined;
		if (orgId) {
			const { data: d, error: dError } = await client
				.from('compute_server_defaults')
				.select('default_server_id')
				.eq('org_id', orgId)
				.maybeSingle();
			if (dError) throw mapError(dError);
			defaultServerId = d?.default_server_id ?? undefined;
		} else {
			const { data: d, error: dError } = await client
				.from('compute_server_platform_default')
				.select('default_server_id')
				.eq('singleton', true)
				.maybeSingle();
			if (dError) throw mapError(dError);
			defaultServerId = d?.default_server_id ?? undefined;
		}

		return {
			servers: (servers ?? []).map(rowToServer),
			defaultServerId
		};
	}

	async saveConfig(ctx: RequestContext, config: ComputeConfig): Promise<void> {
		const client = this.clients.forRequest(ctx);
		const orgId = ctx.actingOrgId ?? null;

		// Replace-all: delete current rows in scope, insert the new set.
		// Not atomic across PostgREST calls — acceptable here because
		// compute-server config is admin-edited and rare.
		const delQuery = orgId
			? client.from('compute_servers').delete().eq('org_id', orgId)
			: client.from('compute_servers').delete().is('org_id', null);
		const { error: delError } = await delQuery;
		if (delError) throw mapError(delError);

		if (config.servers.length > 0) {
			const { error: insError } = await client
				.from('compute_servers')
				.insert(config.servers.map((s) => serverToRow(s, orgId)));
			if (insError) throw mapError(insError);
		}

		const defaultId = config.defaultServerId ?? null;
		if (orgId) {
			const { error } = await client
				.from('compute_server_defaults')
				.upsert({ org_id: orgId, default_server_id: defaultId });
			if (error) throw mapError(error);
		} else {
			const { error } = await client
				.from('compute_server_platform_default')
				.update({ default_server_id: defaultId })
				.eq('singleton', true);
			if (error) throw mapError(error);
		}
	}
}

interface ServerRow {
	id: string;
	org_id: string | null;
	label: string;
	server_url: string;
	api_key: string | null;
	timeout_ms: number | null;
	retry_count: number | null;
}

function rowToServer(row: ServerRow): ComputeServerConfig {
	return {
		id: row.id,
		orgId: row.org_id,
		label: row.label,
		serverUrl: row.server_url,
		apiKey: row.api_key ?? undefined,
		timeoutMs: row.timeout_ms ?? undefined,
		retryCount: row.retry_count ?? undefined
	};
}

function serverToRow(s: ComputeServerConfig, orgId: string | null): ServerRow {
	return {
		id: s.id,
		org_id: orgId,
		label: s.label,
		server_url: s.serverUrl,
		api_key: s.apiKey ?? null,
		timeout_ms: s.timeoutMs ?? null,
		retry_count: s.retryCount ?? null
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
