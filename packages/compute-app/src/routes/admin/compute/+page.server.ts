import type { PageServerLoad } from './$types';
import { getComputeServerProvider } from '$lib/server/providers.server';

export const load: PageServerLoad = async () => {
	try {
		const config = await getComputeServerProvider().getConfig();
		return {
			servers: config.servers ?? [],
			defaultServerId: config.defaultServerId ?? config.servers?.[0]?.id ?? ''
		};
	} catch {
		return { servers: [], defaultServerId: '' };
	}
};
