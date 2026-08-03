import type { RequestHandler } from './$types';
import { z } from 'zod';
import { apiError, ApiErrorCode, throwZodError } from '$lib/server/api-errors';
import type { PipelineInput } from '@selvajs/solve/server';
import { COMPUTE_REQUEST_MAX_BYTES } from '$lib/server/computeLimits';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { runSolve, mapSolveError } from '$lib/server/compute/solve.server';
import {
	withIdempotency,
	idempotencyKey,
	toStoredResponse,
	fromStoredResponse
} from '$lib/server/computeIdempotency.server';

/**
 * The definition-addressed solve — v1's flagship action, and what the CLI's
 * `solve` command maps to.
 *
 * It shares the whole solve core with `POST /api/v1/compute` but reaches it
 * only via the `user` access variant, so a share token can never authorize it:
 * the guid comes from the path, and `locals.ctx` is required. `/api/v1/compute`
 * keeps the URL-addressed and share-token flows.
 */

const SolveBody = z.object({
	inputs: z.array(z.unknown()).default([]),
	values: z.record(z.string(), z.unknown()).default({}),
	channel: z.enum(['live', 'draft']).default('live'),
	versionId: z.string().optional(),
	/**
	 * Accepted only when it names this same definition. A caller pasting a body
	 * from `/api/v1/compute` should get a clear 400, not a silent solve of a
	 * different definition than the URL names.
	 */
	definitionUrl: z.string().optional()
});

export const POST: RequestHandler = async ({ request, params, locals }) => {
	requireMaxBodySize(request, COMPUTE_REQUEST_MAX_BYTES);

	const loadStart = performance.now();
	const prepMarks: [string, number][] = [];
	let prevMark = performance.now();
	const mark = (label: string) => {
		prepMarks.push([label, performance.now() - prevMark]);
		prevMark = performance.now();
	};

	const { guid } = params;
	if (!guid) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing definition guid');
	if (!locals.ctx || !locals.user) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	const ctx = locals.ctx;

	const raw = await request.json().catch(() => null);
	const parsed = SolveBody.safeParse(raw ?? {});
	if (!parsed.success) throwZodError(parsed.error);
	mark('body');

	const definitionUrl = `local:${guid}`;
	if (parsed.data.definitionUrl !== undefined && parsed.data.definitionUrl !== definitionUrl) {
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
			access: { kind: 'user', ctx, rateLimitKey: `user:${locals.user!.id}` },
			definitionUrl,
			inputs: parsed.data.inputs as PipelineInput[],
			values: parsed.data.values,
			channel: parsed.data.channel,
			versionId: parsed.data.versionId ?? null,
			request,
			locals,
			loadStart,
			prepMarks,
			// A guid is guessable, so an unreachable definition must read as
			// missing rather than forbidden.
			concealAccessFailure: true
		});

	try {
		const clientKey = request.headers.get('idempotency-key');
		if (!clientKey) return await solve();

		// Caller identity is part of the key: `Idempotency-Key` is client-chosen,
		// so two tenants can pick the same string. Once PATs land, the token id
		// belongs here so two tokens of one user don't share replays.
		const key = idempotencyKey(locals.user.id, clientKey);
		const { value, replayed } = await withIdempotency(key, async () =>
			toStoredResponse(await solve())
		);
		return fromStoredResponse(value, replayed);
	} catch (err) {
		mapSolveError(err, locals);
	}
};
