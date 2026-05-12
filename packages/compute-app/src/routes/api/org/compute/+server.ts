import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { flag, getComputeServerConfigStore } from '$lib/server/providers.server';
import { requireManageOrgCompute } from '$lib/server/access.server';
import {
	isOrgServer,
	isPlatformServer,
	serversVisibleTo,
	type ComputeServerConfig,
	type OrgComputeServer
} from '@selvajs/platform';

/**
 * Per-org compute endpoint. Manages this org's own servers
 * (`scope: 'org'`) and the org's default selection
 * (`orgDefaults[orgId]`). Platform servers and the global default are
 * read-only here — they're managed by `manage_compute` via `/admin/api/compute`.
 *
 * Authorization: org `owner`/`admin` with `manage_org_compute`. Tenancy is
 * implicit (the user's `actingOrgId` IS the scope). Gated by the platform
 * flag `ALLOW_ORG_COMPUTE_OVERRIDE`; when off, both methods 403.
 */

interface IncomingOrgServer {
	id: string;
	label: string;
	serverUrl: string;
	apiKey?: string | null;
	timeoutMs?: number;
	retryCount?: number;
}

interface IncomingConfig {
	servers: IncomingOrgServer[];
	/**
	 * Org default selection. May reference any server visible to this org
	 * — a platform server shared with us (or `'all'`, or the global
	 * default) or one of our own org-private servers. `null` clears the
	 * override; `undefined` leaves it untouched.
	 */
	defaultServerId?: string | null;
}

function requireFlag() {
	if (!flag('ALLOW_ORG_COMPUTE_OVERRIDE')) {
		throw error(
			403,
			'Per-org compute override is disabled on this instance (ALLOW_ORG_COMPUTE_OVERRIDE).'
		);
	}
}

type OrgServerPayload = Omit<OrgComputeServer, 'apiKey'> & { hasApiKey: boolean };
type SharedServerPayload = Pick<
	ComputeServerConfig,
	'id' | 'label' | 'serverUrl' | 'scope' | 'timeoutMs' | 'retryCount'
> & { source: 'platform' | 'org' };

export const GET: RequestHandler = async ({ locals }) => {
	requireFlag();
	requireManageOrgCompute(locals);
	const ctx = locals.ctx!;
	if (!ctx.actingOrgId) throw error(400, 'No active organization');

	const config = await getComputeServerConfigStore().getConfig(ctx);
	const orgId = ctx.actingOrgId;

	// Servers we own (editable). API keys stripped, replaced with hasApiKey.
	const owned: OrgServerPayload[] = config.servers
		.filter((s) => isOrgServer(s) && s.ownerOrgId === orgId)
		.map((s) => {
			const orgServer = s as OrgComputeServer;
			const { apiKey, ...rest } = orgServer;
			return { ...rest, hasApiKey: !!apiKey };
		});

	// Platform + own servers visible to this org (read-only catalog) — used
	// to populate the "default selection" dropdown.
	const visible = serversVisibleTo(config, orgId);
	const catalog: SharedServerPayload[] = visible.map((s) => ({
		id: s.id,
		label: s.label,
		serverUrl: s.serverUrl,
		scope: s.scope,
		source: isPlatformServer(s) ? 'platform' : 'org',
		timeoutMs: s.timeoutMs,
		retryCount: s.retryCount
	}));

	return json({
		servers: owned,
		defaultServerId: config.orgDefaults?.[orgId] ?? null,
		globalDefaultServerId: config.defaultServerId ?? null,
		catalog
	});
};

// PUT — replace the org's own server set, optionally update the org's default.
// apiKey field semantics:
//   omitted / undefined  → preserve currently stored key (matched by id)
//   null                 → explicitly clear the key
//   non-empty string     → replace with new value
export const PUT: RequestHandler = async ({ request, locals }) => {
	requireFlag();
	requireManageOrgCompute(locals);
	const ctx = locals.ctx!;
	if (!ctx.actingOrgId) throw error(400, 'No active organization');
	const orgId = ctx.actingOrgId;

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');
	const incoming = body as IncomingConfig;
	if (!Array.isArray(incoming.servers)) throw error(400, 'servers must be an array');

	for (const s of incoming.servers) {
		if (!s.id || typeof s.id !== 'string') throw error(400, 'Each server needs an id');
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
	const storedKeyById = new Map(
		existing.servers
			.filter((s) => isOrgServer(s) && s.ownerOrgId === orgId)
			.map((s) => [s.id, s.apiKey])
	);

	const next: OrgComputeServer[] = incoming.servers.map((s) => ({
		id: s.id,
		scope: 'org',
		ownerOrgId: orgId,
		label: s.label,
		serverUrl: s.serverUrl,
		timeoutMs: s.timeoutMs,
		retryCount: s.retryCount,
		apiKey: s.apiKey === null ? undefined : s.apiKey ? s.apiKey : storedKeyById.get(s.id)
	}));

	// Validate the requested orgDefault is visible to this org. Build the
	// projected post-save config so the check sees both the new org-private
	// rows and the existing platform rows.
	if (typeof incoming.defaultServerId === 'string') {
		const projected = {
			servers: [
				...existing.servers.filter((s) => !(isOrgServer(s) && s.ownerOrgId === orgId)),
				...next
			],
			defaultServerId: existing.defaultServerId,
			orgDefaults: existing.orgDefaults
		};
		const visibleIds = new Set(serversVisibleTo(projected, orgId).map((s) => s.id));
		if (!visibleIds.has(incoming.defaultServerId)) {
			throw error(400, 'defaultServerId must reference a server visible to this organization');
		}
	}

	await provider.saveOrgServers(ctx, orgId, next, incoming.defaultServerId);
	return new Response(null, { status: 204 });
};
