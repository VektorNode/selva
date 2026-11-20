import type { RequestEvent, RequestHandler } from './$types';
import { apiError, ApiErrorCode, errorResponse } from '#lib/server/api-errors.js';
import { computeRequestCap } from '#lib/server/compute/engine.server.js';
import { requireMaxBodySize } from '#lib/server/admin-auth.server.js';
import { tryResolveShareToken } from '#lib/server/shareLinks/resolve.server.js';
import { runSolve, mapSolveError, type SolveAccess } from '#lib/server/compute/solve.server.js';
import { SolveModeSchema } from '@selvajs/server/api';
import { respondWithKeepalive, wantsAsync, wantsKeepalive } from '@selvajs/solve/server';
import { startAsyncSolve } from '#lib/server/compute/asyncSolves.server.js';

interface ComputeRequest {
	/** Read for a remote `definitionUrl` only: a stored definition's inputs come from its schema. */
	inputs?: unknown;
	values: Record<string, unknown>;
	definitionUrl: string;
	/** Spec §6 channel selector. Defaults to 'live'. 'draft' requires editor. */
	channel?: 'live' | 'draft';
	/**
	 * Explicit version pick (versioning tab "Run"). Solves this exact version
	 * instead of the channel pointer; editor-only, never share-token accessible.
	 */
	versionId?: string;
	/** The caller's open live-event stream; see `SolveParams.streamId`. */
	streamId?: string;
	/** See `SolveBodySchema.mode`. */
	mode?: string;
}

// The URL-addressed solve: takes an arbitrary `definitionUrl`, and is the only
// route that accepts a share token. The solve mechanics it shares with
// `/api/v1/definitions/{guid}/solve` live in `solve.server.ts`; what stays here
// is the body shape and the share-token branch, which must NOT reach the
// definition-addressed route.
//
// A solve longer than a proxy's timeout still lands two ways. `respond-async` detaches it and the
// caller polls `/api/v1/solves/{id}`; keep-alive holds the request open with filler bytes. Either
// way errors travel after the response has started, which is why they become responses here.
// The body is read first, as `respondWithKeepalive` requires.

export const POST: RequestHandler = async (event) => {
	const received = await receive(event);
	const settled = (signal?: AbortSignal) =>
		solve(event, received, signal).catch((err) => errorResponse(err, event.locals.log));
	if (wantsAsync(event.request)) return startAsyncSolve(event.locals, settled);
	if (wantsKeepalive(event.request)) return respondWithKeepalive(settled());
	return solve(event, received);
};

interface Received {
	body: ComputeRequest;
	/** `performance.now()` when the body read began. */
	loadStart: number;
	bodyMs: number;
}

async function receive({ request, locals }: RequestEvent): Promise<Received> {
	// Reject oversized payloads before buffering.
	requireMaxBodySize(request, computeRequestCap());

	const loadStart = performance.now();
	try {
		const body: ComputeRequest = await request.json();
		return { body, loadStart, bodyMs: performance.now() - loadStart };
	} catch (err) {
		mapSolveError(err, locals);
	}
}

async function solve(
	{ request, locals, url }: RequestEvent,
	{ body, loadStart, bodyMs }: Received,
	signal?: AbortSignal
): Promise<Response> {
	// DEBUG (SELVA_FLAG_COMPUTE_DEBUG): the solve metric's `durationMs` wraps ONLY
	// scheduler.solve, so everything before it (body read, auth, DB reads, definition fetch,
	// input tree build) and the response serialization after it are otherwise invisible.
	// `runSolve` continues these marks and logs the breakdown.
	const prepMarks: [string, number][] = [['body', bodyMs]];
	let prevMark = performance.now();
	const mark = (label: string) => {
		prepMarks.push([label, performance.now() - prevMark]);
		prevMark = performance.now();
	};

	try {
		const { inputs, values } = body;
		const definitionUrl = body.definitionUrl;
		const channel: 'live' | 'draft' = body.channel ?? 'live';
		const explicitVersionId = body.versionId ?? null;

		if (!values || !definitionUrl) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				'Missing required fields: values or definitionUrl'
			);
		}
		const mode = SolveModeSchema.default('full').safeParse(body.mode);
		if (!mode.success) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				`Invalid mode: ${String(body.mode)}. Must be 'preview' or 'full'.`
			);
		}
		if (channel !== 'live' && channel !== 'draft') {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				`Invalid channel: ${channel}. Must be 'live' or 'draft'.`
			);
		}

		// Share-link tokens (spec §7); null for remote definitions or no token.
		const isLocal = definitionUrl.startsWith('local:');
		const guid = isLocal ? definitionUrl.substring(6) : null;
		// Explicit-version solves are editor-only, so don't resolve a share token
		// for them — force the logged-in editor gate instead.
		const sharedAccess =
			isLocal && guid && !explicitVersionId
				? await tryResolveShareToken(request, url, guid, channel, { requireSolve: true })
				: null;
		mark('shareToken');

		if (!sharedAccess && (!locals.ctx || !locals.user)) {
			apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
		}

		// Rate-limit bucket per caller: `share:{linkId}` for token solves so an
		// anonymous crowd on one public link can't drain the owner's budget.
		const access: SolveAccess = sharedAccess
			? {
					kind: 'share',
					ctx: sharedAccess.ctx,
					link: sharedAccess.link,
					rateLimitKey: `share:${sharedAccess.link.id}`
				}
			: { kind: 'user', ctx: locals.ctx!, rateLimitKey: `user:${locals.user!.id}` };

		return await runSolve({
			access,
			definitionUrl,
			inputs,
			values,
			channel,
			versionId: explicitVersionId,
			request,
			signal,
			locals,
			loadStart,
			prepMarks,
			streamId: typeof body.streamId === 'string' ? body.streamId : null,
			solveMode: mode.data
		});
	} catch (err) {
		mapSolveError(err, locals);
	}
}
