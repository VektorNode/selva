import type { PageServerLoad } from './$types';
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { assertManageCompute } from '$lib/server/access.server';

export const load: PageServerLoad = async ({ locals }) => {
	assertManageCompute(locals);
	try {
		// Admin compute page manages the instance pool — strip actingOrgId so
		// reads match what /admin/api/compute writes. See Permissions.md §3.
		const ctx = { ...locals.ctx!, actingOrgId: undefined, orgPermissions: [] };
		const config = await getComputeServerConfigStore().getConfig(ctx);
		return {
			servers: config.servers ?? [],
			defaultServerId: config.defaultServerId ?? config.servers?.[0]?.id ?? ''
		};
	} catch (err) {
		// Let auth errors bubble up; only catch data loading failures
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		return { servers: [], defaultServerId: '' };
	}
};
