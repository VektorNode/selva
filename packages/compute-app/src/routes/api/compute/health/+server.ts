import { getComputeEndpoint } from '$lib/server/compute/server-checks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const data = await getComputeEndpoint('/healthcheck');
		if (data == 'Healthy') return new Response(null, { status: 200 });
		return new Response(null, { status: 503 });
	} catch {
		return new Response(JSON.stringify({ error: 'Compute server is unreachable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
