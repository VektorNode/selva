import { getComputeEndpoint } from '$lib/server/compute/server-checks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const installed = await getComputeEndpoint('/plugins/gh/installed');
		return new Response(JSON.stringify(installed), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch {
		return new Response(JSON.stringify({ error: 'Compute server is unreachable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
