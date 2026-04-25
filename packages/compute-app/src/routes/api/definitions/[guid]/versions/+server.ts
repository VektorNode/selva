import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionMeta } from '$lib/server/providers.server';
import { handleApiError } from '$lib/server/api-errors';
import { GuidSchema } from '@selva/platform/definitions/schemas';

/**
 * GET /api/definitions/[guid]/versions — list versions newest first.
 * Authorization is derived from project visibility (the caller must already
 * be allowed to view the definition's parent). The store filters
 * soft-deleted definitions so we don't need an explicit canView here.
 */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');
	if (!locals.ctx) throw error(401, 'Unauthorized');

	const limit = Number(url.searchParams.get('limit') ?? 50);
	const cursor = url.searchParams.get('cursor') ?? undefined;

	try {
		const def = await getDefinitionMeta().get(locals.ctx, guidParsed.data);
		if (!def) throw error(404, 'Definition not found');
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
