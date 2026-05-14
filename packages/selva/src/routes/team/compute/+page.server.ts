import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasPermission, isOrgServer, isPlatformServer, serversVisibleTo } from '@selvajs/platform';
import type {
	ComputeServerConfig,
	OrgComputeServer,
	PlatformComputeServer
} from '@selvajs/platform';
import { flag, getComputeServerConfigStore } from '$lib/server/providers.server';

/**
 * Org-scope compute settings. Spec §3.
 *
 * - Lists the platform servers visible to this org (read-only catalog).
 * - Lists this org's own org-private servers (editable).
 * - Surfaces the global default + the per-org default selection.
 *
 * Gated by `manage_org_compute`. Org-private server management is further
 * gated by the platform flag `ALLOW_ORG_COMPUTE_OVERRIDE`; when off, the
 * page renders read-only with an explanatory note.
 */

export type CatalogEntry = Pick<
	ComputeServerConfig,
	'id' | 'label' | 'serverUrl' | 'scope' | 'timeoutMs' | 'retryCount'
> & {
	source: 'platform' | 'org';
	isGlobalDefault: boolean;
};

export type OrgServerListing = Omit<OrgComputeServer, 'apiKey'> & { hasApiKey: boolean };

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	if (!ctx) redirect(303, '/login');
	if (!hasPermission(ctx, 'manage_org_compute')) redirect(303, '/team');
	if (!ctx.actingOrgId) redirect(303, '/team');

	const orgId = ctx.actingOrgId;
	const overrideEnabled = flag('ALLOW_ORG_COMPUTE_OVERRIDE');

	const config = await getComputeServerConfigStore().getConfig(ctx);

	// Servers we own — editable.
	const ownServers: OrgServerListing[] = config.servers
		.filter((s): s is OrgComputeServer => isOrgServer(s) && s.ownerOrgId === orgId)
		.map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: !!apiKey }));

	// Catalog drives the default-selection dropdown — every server visible to
	// this org regardless of scope.
	const visible = serversVisibleTo(config, orgId);
	const catalog: CatalogEntry[] = visible.map((s) => ({
		id: s.id,
		label: s.label,
		serverUrl: s.serverUrl,
		scope: s.scope,
		source: isPlatformServer(s) ? 'platform' : 'org',
		timeoutMs: s.timeoutMs,
		retryCount: s.retryCount,
		isGlobalDefault: s.id === config.defaultServerId
	}));

	return {
		ownServers,
		catalog,
		orgDefaultServerId: config.orgDefaults?.[orgId] ?? null,
		globalDefaultServerId: config.defaultServerId ?? null,
		overrideEnabled
	};
};

// Re-exported for the page component.
export type { ComputeServerConfig, OrgComputeServer, PlatformComputeServer };
