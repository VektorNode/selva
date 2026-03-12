import { getComputeEndpoint } from '$lib/server/compute/server-checks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const installed = await getComputeEndpoint('/plugins/gh/installed');

	return new Response(JSON.stringify(installed), {
		headers: { 'Content-Type': 'application/json' }
	});
};
