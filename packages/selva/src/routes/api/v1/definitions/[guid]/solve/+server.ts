import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode, handleApiError } from '$lib/server/api-errors';
import { parseBody, requireCaller, requireParams } from '$lib/server/api/http';
import type { PipelineInput } from '@selvajs/solve/server';
import { COMPUTE_REQUEST_MAX_BYTES } from '$lib/server/computeLimits';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { runSolve, mapSolveError } from '$lib/server/compute/solve.server';
import { solveIdempotencyStore } from '$lib/server/computeIdempotency.server';
import {
	SolveBodySchema,
	idempotencyCallerId,
	readIdempotencyKey,
	requestFingerprint,
	runIdempotent
} from '@selvajs/server/api';

/**
 * The definition-addressed solve — v1's flagship action, and what the CLI's
 * `solve` command maps to.
 *
 * It shares the whole solve core with `POST /api/v1/compute` but reaches it
 * only via the `user` access variant, so a share token can never authorize it:
 * the guid comes from the path, and `locals.ctx` is required. `/api/v1/compute`
 * keeps the URL-addressed and share-token flows.
 */

export const POST: RequestHandler = async ({ request, params, locals, url }) => {
	requireMaxBodySize(request, COMPUTE_REQUEST_MAX_BYTES);

	const loadStart = performance.now();
	const prepMarks: [string, number][] = [];
	let prevMark = performance.now();
	const mark = (label: string) => {
		prepMarks.push([label, performance.now() - prevMark]);
		prevMark = performance.now();
	};

	const { guid } = requireParams(params, 'guid');
	const { ctx, user } = requireCaller(locals);

	// This route streams and marks its own metrics, so it is deliberately not
	// wrapped in `apiRoute`/`mount` — nothing above it turns a thrown error into
	// the response envelope. `parseBody` raises `ApiError` now that the request
	// helpers are transport-free, so it is funnelled through `handleApiError`
	// here; without it a bad body escapes as an unhandled 500, not the 400 it is.
	const body = await parseBody(request, SolveBodySchema, { missingAs: {} }).catch((err) =>
		handleApiError(err, 'Invalid solve request', locals.log)
	);
	mark('body');

	const definitionUrl = `local:${guid}`;
	if (body.definitionUrl !== undefined && body.definitionUrl !== definitionUrl) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`definitionUrl must be '${definitionUrl}' or omitted on this endpoint.`
		);
	}

	const solve = () =>
		runSolve({
			// The `user` variant is the only one constructible here — this route has
			// no share-token branch and must never grow one.
			access: { kind: 'user', ctx, rateLimitKey: `user:${user.id}` },
			definitionUrl,
			inputs: body.inputs as PipelineInput[],
			values: body.values,
			channel: body.channel,
			versionId: body.versionId ?? null,
			request,
			locals,
			loadStart,
			prepMarks,
			// A guid is guessable, so an unreachable definition must read as
			// missing rather than forbidden.
			concealAccessFailure: true
		});

	try {
		const clientKey = readIdempotencyKey(request);
		if (!clientKey) return await solve();

		// The body is already consumed, so the fingerprint hashes the parsed value.
		return await runIdempotent(
			{
				store: solveIdempotencyStore,
				callerId: idempotencyCallerId(ctx),
				clientKey,
				fingerprint: await requestFingerprint('POST', url.pathname, JSON.stringify(body))
			},
			solve
		);
	} catch (err) {
		mapSolveError(err, locals);
	}
};
