import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import type { PipelineInput } from '@selvajs/solve/server';
import { COMPUTE_REQUEST_MAX_BYTES } from '$lib/server/computeLimits';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server';
import { runSolve, mapSolveError, type SolveAccess } from '$lib/server/compute/solve.server';

interface ComputeRequest {
	inputs: PipelineInput[];
	values: Record<string, unknown>;
	definitionUrl: string;
	/** Spec §6 channel selector. Defaults to 'live'. 'draft' requires editor. */
	channel?: 'live' | 'draft';
	/**
	 * Explicit version pick (versioning tab "Run"). Solves this exact version
	 * instead of the channel pointer; editor-only, never share-token accessible.
	 */
	versionId?: string;
}

// The URL-addressed solve: takes an arbitrary `definitionUrl`, and is the only
// route that accepts a share token. The solve mechanics it shares with
// `/api/v1/definitions/{guid}/solve` live in `solve.server.ts`; what stays here
// is the body shape and the share-token branch, which must NOT reach the
// definition-addressed route.

export const POST: RequestHandler = async ({ request, locals, url }) => {
	// Reject oversized payloads before buffering.
	requireMaxBodySize(request, COMPUTE_REQUEST_MAX_BYTES);

	// DEBUG (SELVA_FLAG_COMPUTE_DEBUG): start of server-side work. The solve metric's
	// `durationMs` wraps ONLY scheduler.solve, so everything before it (auth, DB reads,
	// definition fetch, input tree build) and the response serialization after it are
	// otherwise invisible. `runSolve` continues these marks and logs the breakdown.
	const loadStart = performance.now();
	const prepMarks: [string, number][] = [];
	let prevMark = performance.now();
	const mark = (label: string) => {
		prepMarks.push([label, performance.now() - prevMark]);
		prevMark = performance.now();
	};

	try {
		const body: ComputeRequest = await request.json();
		mark('body');

		const { inputs, values } = body;
		const definitionUrl = body.definitionUrl;
		const channel: 'live' | 'draft' = body.channel ?? 'live';
		const explicitVersionId = body.versionId ?? null;

		if (!inputs || !values || !definitionUrl) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				'Missing required fields: inputs, values, or definitionUrl'
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
			locals,
			loadStart,
			prepMarks
		});
	} catch (err) {
		mapSolveError(err, locals);
	}
};
