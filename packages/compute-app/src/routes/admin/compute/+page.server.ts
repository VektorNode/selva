import type { PageServerLoad } from './$types';
import { getComputeServerProvider } from '$lib/server/providers.server';

export const load: PageServerLoad = async () => {
	try {
		const config = await getComputeServerProvider().getConfig();
		return {
			servers: config.servers ?? [],
			defaultServer: config.defaultServer ?? config.servers?.[0]?.label ?? ''
		};
	} catch {
		return { servers: [], defaultServer: '' };
	}
};
