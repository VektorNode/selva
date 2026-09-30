import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { getSolveEventBus } from '$lib/server/solveEvents/bus.server';
import { parseCallbackEvents, readBearer } from '$lib/server/solveEvents/ingest.server';
import { verifySolveToken } from '$lib/server/solveEvents/token.server';

// The callback the Selva plugin POSTs to from inside a Rhino.Compute solve. No session:
// the bearer is the per-solve token `runSolve` minted, scoped to this `solveId`. The reply
// is the only way back into the solve, which is why it carries `abort`.

const MAX_BODY_BYTES = 256 * 1024;
const SOLVE_ID = /^[A-Za-z0-9-]{8,64}$/;

export const POST: RequestHandler = async ({ params, request }) => {
	requireMaxBodySize(request, MAX_BODY_BYTES);

	const { solveId } = params;
	if (!SOLVE_ID.test(solveId) || !verifySolveToken(solveId, readBearer(request))) {
		apiError(401, ApiErrorCode.UNAUTHORIZED, 'Invalid solve token');
	}

	const bus = getSolveEventBus();
	// 410 rather than 404: the plugin reads it as "the requester is gone" and aborts a solution
	// that is still running, so a cancelled or timed-out request frees the Compute child.
	if (!bus.isOpen(solveId)) apiError(410, ApiErrorCode.NOT_FOUND, 'Solve is no longer open');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Body must be JSON');
	}

	return json(bus.publish(solveId, parseCallbackEvents(body, new Date().toISOString())));
};
