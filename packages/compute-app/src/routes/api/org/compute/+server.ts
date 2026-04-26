import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { flag, getComputeServerConfigStore } from '$lib/server/providers.server';
import { requireManageOrgCompute } from '$lib/server/access.server';
import type { ComputeConfig, ComputeServerConfig } from '@selva/platform';

/**
 * Spec §3 — per-org BYO compute override. Reads/writes the calling org's
 * scope (via `ctx.actingOrgId`); the platform flag `ALLOW_ORG_COMPUTE_OVERRIDE`
 * gates the entire route. When the flag is off, both methods 403 with a
 * pointer to the platform setting.
 *
 * Authorization: org `owner`/`admin` with `manage_org_compute`. Tenancy is
 * implicit (the user's `actingOrgId` IS the scope).
 */

type ServerWithKeyFlag = Omit<ComputeServerConfig, 'apiKey'> & { hasApiKey: boolean };
type IncomingServer = Omit<ComputeServerConfig, 'apiKey' | 'orgId'> & { apiKey?: string | null };
interface IncomingConfig {
	servers: IncomingServer[];
	defaultServerId?: string;
}

function requireFlag() {
	if (!flag('ALLOW_ORG_COMPUTE_OVERRIDE')) {
		throw error(
			403,
			'Per-org compute override is disabled on this instance (ALLOW_ORG_COMPUTE_OVERRIDE).'
		);
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	requireFlag();
	requireManageOrgCompute(locals);
	const ctx = locals.ctx!;
	if (!ctx.actingOrgId) throw error(400, 'No active organization');

	const config = await getComputeServerConfigStore().getConfig(ctx);
	return json({
		...config,
		servers: config.servers.map(
			({ apiKey, ...rest }): ServerWithKeyFlag => ({
				...rest,
				hasApiKey: !!apiKey
			})
		)
	});
};

// PUT — replace the org's full compute config.
// apiKey field semantics:
//   omitted / undefined  → preserve currently stored key (matched by serverUrl)
//   null                 → explicitly clear the key
//   non-empty string     → replace with new value
export const PUT: RequestHandler = async ({ request, locals }) => {
	requireFlag();
	requireManageOrgCompute(locals);
	const ctx = locals.ctx!;
	if (!ctx.actingOrgId) throw error(400, 'No active organization');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');
	const incoming = body as IncomingConfig;
	if (!Array.isArray(incoming.servers)) throw error(400, 'servers must be an array');

	for (const s of incoming.servers) {
		if (!s.label || typeof s.label !== 'string') throw error(400, 'Each server needs a label');
		if (!s.serverUrl || typeof s.serverUrl !== 'string')
			throw error(400, 'Each server needs a serverUrl');
		try {
			new URL(s.serverUrl);
		} catch {
			throw error(400, `Invalid serverUrl: ${s.serverUrl}`);
		}
		if (s.apiKey !== undefined && s.apiKey !== null && typeof s.apiKey !== 'string')
			throw error(400, 'apiKey must be a string, null, or omitted');
	}

	const provider = getComputeServerConfigStore();
	const existing = await provider.getConfig(ctx);
	const storedKeyMap = new Map(existing.servers.map((s) => [s.serverUrl, s.apiKey]));

	const merged: ComputeConfig = {
		...incoming,
		servers: incoming.servers.map(({ apiKey, ...s }) => ({
			...s,
			orgId: ctx.actingOrgId,
			apiKey: apiKey === null ? undefined : apiKey ? apiKey : storedKeyMap.get(s.serverUrl)
		}))
	};

	await provider.saveConfig(ctx, merged);
	return new Response(null, { status: 204 });
};
