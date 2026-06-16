import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema, PublishVersionInputSchema } from '@selvajs/platform/definitions';

/**
 * POST /api/definitions/[guid]/publish — advance the live channel.
 *   - body `{ versionId? }` — target a specific version (rollback or
 *     forward-roll). Omit to promote the current draft.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');

	const body = await request.json().catch(() => ({}));
	const parsed = PublishVersionInputSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		const version = await getDefinitionService().publish(
			ctx,
			guidParsed.data,
			parsed.data.versionId
		);
		return json({ version });
	} catch (err) {
		handleApiError(err, 'Failed to publish version');
	}
};
