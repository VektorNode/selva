import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { definitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { GuidSchema, PublishVersionInputSchema } from '@selvajs/platform/definitions';

/**
 * POST /api/definitions/[guid]/publish — advance the live channel.
 *   - body `{ versionId? }` — target a specific version (rollback or
 *     forward-roll). Omit to promote the current draft.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const body = await request.json().catch(() => ({}));
	const parsed = PublishVersionInputSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		const version = await definitionService.publish(ctx, guidParsed.data, parsed.data.versionId);
		return json({ success: true, version });
	} catch (err) {
		handleApiError(err, 'Failed to publish version');
	}
};
