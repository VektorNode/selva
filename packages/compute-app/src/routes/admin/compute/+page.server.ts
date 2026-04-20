import type { PageServerLoad } from './$types';
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { assertManageCompute } from '$lib/server/access.server';

export const load: PageServerLoad = async ({ locals }) => {
	assertManageCompute(locals);
	try {
		const config = await getComputeServerConfigStore().getConfig();
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
