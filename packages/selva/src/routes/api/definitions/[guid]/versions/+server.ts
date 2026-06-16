import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionMeta } from '$lib/server/providers.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { requireCanViewProject } from '$lib/server/access.server';
import { GuidSchema } from '@selvajs/platform/definitions';
import { MAX_PAGE_LIMIT } from '@selvajs/platform';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');
	if (!locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

	const rawLimit = Number(url.searchParams.get('limit') ?? 50);
	const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT) : 50;
	const cursor = url.searchParams.get('cursor') ?? undefined;

	try {
		const def = await getDefinitionMeta().get(locals.ctx, guidParsed.data);
		if (!def) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');
		await requireCanViewProject(locals, def.projectId);
		const page = await getDefinitionMeta().listVersions(locals.ctx, guidParsed.data, {
			limit,
			cursor
		});
		return json({
			versions: page.items,
			nextCursor: page.nextCursor,
			liveVersionId: def.liveVersionId,
			draftVersionId: def.draftVersionId
		});
	} catch (err) {
		handleApiError(err, 'Failed to list versions');
	}
};
