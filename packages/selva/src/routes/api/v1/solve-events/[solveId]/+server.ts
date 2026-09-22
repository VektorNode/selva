import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { getSolveEventBus } from '$lib/server/solveEvents/bus.server';
import { verifySolveToken } from '$lib/server/solveEvents/token.server';

// The callback the Selva plugin POSTs to from inside a Rhino.Compute solve. No session:
// the bearer is the per-solve token `runSolve` minted, scoped to this `solveId`. The reply
// is the only way back into the solve, which is why it carries `abort`.

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS_PER_POST = 256;
const SOLVE_ID = /^[A-Za-z0-9-]{8,64}$/;

interface IncomingEvent {
	type: string;
	at?: string;
	payload?: Record<string, unknown> | null;
}

function readBearer(request: Request): string | null {
	const auth = request.headers.get('authorization');
	return auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
}

export const POST: RequestHandler = async ({ params, request }) => {
	requireMaxBodySize(request, MAX_BODY_BYTES);

	const { solveId } = params;
	if (!SOLVE_ID.test(solveId) || !verifySolveToken(solveId, readBearer(request))) {
		apiError(401, ApiErrorCode.UNAUTHORIZED, 'Invalid solve token');
	}

	const bus = getSolveEventBus();
	// 410 rather than 404: tells the plugin the solve is over so it stops posting, which
	// matters after an abort, when Grasshopper never reaches SolutionEnd.
	if (!bus.isOpen(solveId)) apiError(410, ApiErrorCode.NOT_FOUND, 'Solve is no longer open');

	let body: { events?: unknown };
	try {
		body = await request.json();
	} catch {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Body must be JSON');
	}

	const raw = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_POST) : [];
	const now = new Date().toISOString();
	const events = raw.flatMap(
		(e): Array<{ type: string; at: string; payload?: Record<string, unknown> }> => {
			const candidate = e as IncomingEvent;
			if (!candidate || typeof candidate.type !== 'string' || !candidate.type) return [];
			const payload =
				candidate.payload && typeof candidate.payload === 'object' ? candidate.payload : undefined;
			return [
				{ type: candidate.type, at: typeof candidate.at === 'string' ? candidate.at : now, payload }
			];
		}
	);

	return json(bus.publish(solveId, events));
};
