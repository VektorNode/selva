import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getSolveEventBus } from '$lib/server/solveEvents/bus.server';
import { liveOwnerKey } from '$lib/server/solveEvents/liveSolve.server';
import { openSolveEventStream } from '$lib/server/solveEvents/sse.server';
import { asHttpError } from '$lib/server/access.server';
import { assertScope } from '@selvajs/server/api';

// One SSE stream per browser tab. The tab mints `streamId` and sends it with every
// solve request; the server routes that solve's events here. Self-gating (the hook
// does not deny it) because the sibling callback route under the same prefix has no
// session at all — this route still requires one.

const STREAM_ID = /^[A-Za-z0-9_-]{16,64}$/;

export const GET: RequestHandler = async ({ url, locals, request }) => {
	const ownerKey = liveOwnerKey(locals.user?.id);
	if (!ownerKey) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	await asHttpError(() => assertScope(locals.ctx, 'read'));

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
};
