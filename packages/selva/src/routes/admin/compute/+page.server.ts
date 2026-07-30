import type { PageServerLoad } from './$types';
import {
	getComputeServerConfigStore,
	getOrganizationProvider,
	getTenancy
} from '$lib/server/providers.server';
import { assertManageCompute } from '$lib/server/access.server';
import { platformServers, type Organization } from '@selvajs/platform';
import { solveCacheStats } from '$lib/server/compute/clientCache.server';
import { definitionByteCacheStats } from '$lib/server/compute/definitionByteCache.server';
import {
	COMPUTE_SOLVE_CACHE_BYTES,
	COMPUTE_DEFINITION_CACHE_BYTES
} from '$lib/server/computeLimits';

/**
 * Live counters for the two named caches. Read from the running process, so they
 * describe THIS instance only — behind a load balancer each instance has its own
 * warm caches and its own numbers.
 */
function readCacheStats() {
	const solve = solveCacheStats();
	const definition = definitionByteCacheStats();
	return {
		solve: {
			...solve,
			budgetBytes: COMPUTE_SOLVE_CACHE_BYTES,
			// Per warm client, so the ceiling is the budget × however many are alive.
			budgetTotalBytes: COMPUTE_SOLVE_CACHE_BYTES * Math.max(1, solve.warmClients)
		},
		definition: {
			hits: definition.hits,
			misses: definition.misses,
			evictions: definition.evictions,
			entries: definition.entries,
			bytes: definition.bytes,
			budgetBytes: COMPUTE_DEFINITION_CACHE_BYTES
		}
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	assertManageCompute(locals);
	const tenancy = getTenancy();
	const caches = readCacheStats();
	try {
		const config = await getComputeServerConfigStore().getConfig(locals.ctx!);
		const servers = platformServers(config).map(({ apiKey: _apiKey, hasApiKey, ...rest }) => ({
			...rest,
			hasApiKey: !!hasApiKey
		}));

		// Org list drives the per-server "Available to" allowlist control. Skip
		// the fetch in single-tenancy — the control is hidden there. Otherwise
		// cap is generous: admin compute UIs aren't paginated and we want all
		// orgs in the picker without a network hop per row.
		let orgs: Pick<Organization, 'id' | 'name' | 'slug'>[] = [];
		if (tenancy !== 'single') {
			const orgsPage = await getOrganizationProvider().listOrgs(locals.ctx!, { limit: 500 });
			orgs = orgsPage.items.map((o) => ({ id: o.id, name: o.name, slug: o.slug }));
		}

		return {
			servers,
			defaultServerId: config.defaultServerId ?? servers[0]?.id ?? '',
			orgs,
			tenancy,
			caches
		};
	} catch (err) {
		// Let auth errors bubble up; only catch data loading failures
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		return { servers: [], defaultServerId: '', orgs: [], tenancy, caches };
	}
};
