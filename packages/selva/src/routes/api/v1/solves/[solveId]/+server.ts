import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { ASYNC_POLL_WAIT_S, storedToResponse } from '@selvajs/solve/server';
import { assertScopeAnywhere } from '@selvajs/server/api';
import { asyncSolveOwner, getAsyncSolves } from '#lib/server/compute/asyncSolves.server.js';
import { apiError, ApiErrorCode } from '#lib/server/api-errors.js';
import { asHttpError } from '#lib/server/access.server.js';

// A detached solve, started by a solve route with `Prefer: respond-async`. Self-gating: a
// share-link viewer has no session, so a solve started without a user is read by its unguessable
// id alone, and one started by a user only by that user (the store checks).

const GONE =
	'The solve is no longer available: it finished more than 10 minutes ago, or the server restarted. Solve again.';

export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	await asHttpError(() => assertScopeAnywhere(locals.ctx, 'read'));
	const wait = Number(url.searchParams.get('wait') ?? 0);
	const waitMs = Math.min(Math.max(Number.isFinite(wait) ? wait : 0, 0), ASYNC_POLL_WAIT_S) * 1000;
	const read = await getAsyncSolves().read(
		params.solveId,
		asyncSolveOwner(locals),
		waitMs,
		request.signal
	);
	if (read.kind === 'unknown') apiError(404, ApiErrorCode.NOT_FOUND, GONE);
	if (read.kind === 'running') {
		return json(
			{ solveId: params.solveId },
			{
				status: 202,
				headers: { 'Cache-Control': 'no-store', 'Preference-Applied': 'respond-async' }
			}
		);
	}
	return storedToResponse(read);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await asHttpError(() => assertScopeAnywhere(locals.ctx, 'solve'));
	if (!getAsyncSolves().cancel(params.solveId, asyncSolveOwner(locals))) {
		apiError(404, ApiErrorCode.NOT_FOUND, 'No such solve');
	}
	return new Response(null, { status: 204 });
};
