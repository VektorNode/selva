import { getComputeEndpoint } from '$lib/server/compute/server-checks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const data = await getComputeEndpoint('/healthcheck');
	if (data == 'Healthy') return new Response(null, { status: 200 });
	return new Response(null, { status: 503 });
};
