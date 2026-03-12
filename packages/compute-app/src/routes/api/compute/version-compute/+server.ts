import { getComputeEndpoint } from '$lib/server/compute/server-checks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const data = await getComputeEndpoint('/version');
	return new Response(JSON.stringify(data), {
		headers: { 'Content-Type': 'application/json' }
	});
};
