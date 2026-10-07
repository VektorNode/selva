import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getSolveEventBus } from '$lib/server/solveEvents/bus.server';
import { liveOwnerKey } from '$lib/server/solveEvents/liveSolve.server';
import { asHttpError } from '$lib/server/access.server';
import { assertScope } from '@selvajs/server/api';

// Flags a running solve for abort. The flag rides back to the plugin on its next callback
// reply (see `solve-events/[solveId]`), so the effect is cooperative: Grasshopper stops at
// the next component boundary and the stream gets a `solveEnded`.

export const POST: RequestHandler = async ({ params, locals }) => {
	const ownerKey = liveOwnerKey(locals.user?.id);
	if (!ownerKey) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	await asHttpError(() => assertScope(locals.ctx, 'solve'));

	// Only the owner of the stream that started a solve may stop it.
	const ok = getSolveEventBus().requestAbort(params.solveId, ownerKey);
	if (!ok) apiError(404, ApiErrorCode.NOT_FOUND, 'No such running solve');

	return new Response(null, { status: 204 });
};
