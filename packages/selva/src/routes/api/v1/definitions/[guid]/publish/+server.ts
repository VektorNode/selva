import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { GuidSchema, PublishVersionInputSchema } from '@selvajs/platform/definitions';
import { apiRoute, parseBody, parseParam } from '$lib/server/api/v1/route';

/**
 * Advance the live channel. Body `{ versionId? }` targets a specific version
 * (rollback or forward-roll); omit it to promote the current draft.
 */
export const POST: RequestHandler = apiRoute(
	'Failed to publish version',
	async ({ params, request, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const { versionId } = await parseBody(request, PublishVersionInputSchema, { missingAs: {} });

		const { ctx } = await requireEditableDefinition(locals, guid);
		return json({ version: await getDefinitionService().publish(ctx, guid, versionId) });
	}
);
