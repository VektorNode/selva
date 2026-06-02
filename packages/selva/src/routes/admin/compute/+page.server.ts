import type { PageServerLoad } from './$types';
import {
	getComputeServerConfigStore,
	getOrganizationProvider,
	getTenancy
} from '$lib/server/providers.server';
import { assertManageCompute } from '$lib/server/access.server';
import { platformServers, type Organization } from '@selvajs/platform';

export const load: PageServerLoad = async ({ locals }) => {
	assertManageCompute(locals);
	const tenancy = getTenancy();
	try {
		const config = await getComputeServerConfigStore().getConfig(locals.ctx!);
		const servers = platformServers(config).map(({ apiKey, ...rest }) => ({
			...rest,
			hasApiKey: !!apiKey
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
			tenancy
		};
	} catch (err) {
		// Let auth errors bubble up; only catch data loading failures
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		return { servers: [], defaultServerId: '', orgs: [], tenancy };
	}
};
