import type { RequestHandler } from './$types';
import { withApiRateLimit } from '$lib/server/api/sveltekit';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getSolveEventBus } from '$lib/server/solveEvents/bus.server';
import { liveOwnerKey } from '$lib/server/solveEvents/liveSolve.server';
import { openSolveEventStream } from '$lib/server/solveEvents/sse.server';
import { asHttpError } from '$lib/server/access.server';
import { assertScopeAnywhere } from '@selvajs/server/api';

// One SSE stream per browser tab. The tab mints `streamId` and sends it with every
// solve request; the server routes that solve's events here. Self-gating (the hook
// does not deny it) because the sibling callback route under the same prefix has no
// session at all — this route still requires one.

const STREAM_ID = /^[A-Za-z0-9_-]{16,64}$/;

export const GET: RequestHandler = withApiRateLimit(async ({ url, locals, request }) => {
	const ownerKey = liveOwnerKey(locals.user?.id);
	if (!ownerKey) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	await asHttpError(() => assertScopeAnywhere(locals.ctx, 'read'));

	const streamId = url.searchParams.get('streamId') ?? '';
	if (!STREAM_ID.test(streamId)) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'streamId must be 16-64 URL-safe characters');
	}

	const response = openSolveEventStream({
		bus: getSolveEventBus(),
		streamId,
		ownerKey,
		signal: request.signal
	});
	if (!response) apiError(409, ApiErrorCode.CONFLICT, 'streamId is in use');
	return response;
});
