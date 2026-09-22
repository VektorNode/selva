import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getSolveEventBus } from '$lib/server/solveEvents/bus.server';

// Flags a running solve for abort. The flag rides back to the plugin on its next callback
// reply (see `solve-events/[solveId]`), so the effect is cooperative: Grasshopper stops at
// the next component boundary and the stream gets a `solveEnded`.

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

	// Same owner key the SSE route and `runSolve` use; only the tab that started a solve may
	// stop it.
	const ok = getSolveEventBus().requestAbort(params.solveId, `user:${locals.user.id}`);
	if (!ok) apiError(404, ApiErrorCode.NOT_FOUND, 'No such running solve');

	return new Response(null, { status: 204 });
};
