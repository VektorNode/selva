import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { requireManageCompute } from '$lib/server/access.server';
import type { ComputeConfig, ComputeServerConfig, RequestContext } from '@selva/platform';

type ServerWithKeyFlag = Omit<ComputeServerConfig, 'apiKey'> & { hasApiKey: boolean };

type IncomingServer = Omit<ComputeServerConfig, 'apiKey' | 'orgId'> & { apiKey?: string | null };

interface IncomingConfig {
	servers: IncomingServer[];
	defaultServerId?: string;
}

/**
 * Build a ctx scoped to the instance pool — the admin compute route manages
 * the instance-wide servers (org_id NULL), never the user's actingOrg. We
 * strip `actingOrgId` from the user's ctx so the store reads/writes the
 * right scope.
 */
function instanceCtx(ctx: RequestContext): RequestContext {
	return { ...ctx, actingOrgId: undefined, orgPermissions: [] };
}

// GET — return compute config with API keys stripped and replaced by hasApiKey flag
export const GET: RequestHandler = async ({ locals }) => {
	requireManageCompute(locals);
	try {
		const config = await getComputeServerConfigStore().getConfig(instanceCtx(locals.ctx!));
		return json({
			...config,
			servers: config.servers.map(
				({ apiKey, ...rest }): ServerWithKeyFlag => ({
					...rest,
					hasApiKey: !!apiKey
				})
			)
		});
	} catch (err) {
		console.error('[Compute GET] Failed:', err);
		throw error(500, 'Failed to load compute config');
	}
};

// PUT — replace full compute config
// apiKey field semantics:
//   omitted / undefined  → preserve the currently stored key (matched by serverUrl)
//   null                 → explicitly clear the key
//   non-empty string     → replace with new value
export const PUT: RequestHandler = async ({ request, locals }) => {
	requireManageCompute(locals);
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

	try {
		const provider = getComputeServerConfigStore();
		const ctx = instanceCtx(locals.ctx!);
		const existing = await provider.getConfig(ctx);

		// Build a lookup map from serverUrl → stored apiKey for stable key preservation.
		const storedKeyMap = new Map(existing.servers.map((s) => [s.serverUrl, s.apiKey]));

		const merged: ComputeConfig = {
			...incoming,
			servers: incoming.servers.map(({ apiKey, ...s }) => ({
				...s,
				orgId: null,
				apiKey:
					apiKey === null
						? undefined // explicit clear
						: apiKey
							? apiKey // new value provided
							: storedKeyMap.get(s.serverUrl) // preserve by identity
			}))
		};

		await provider.saveConfig(ctx, merged);
		return new Response(null, { status: 204 });
	} catch (err) {
		console.error('[Compute PUT] Failed:', err);
		throw error(500, 'Failed to save compute config');
	}
};
