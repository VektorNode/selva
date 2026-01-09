import { json, type RequestHandler } from '@sveltejs/kit';

/**
 * Health check endpoint for load balancers and orchestration systems.
 * Used by Docker healthchecks, Kubernetes liveness probes, and monitoring tools.
 */
export const GET: RequestHandler = async () => {
	return json({ status: 'ok', timestamp: new Date().toISOString() });
};
