import type { RequestHandler } from './$types';
import { providers, flag } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';

/**
 * DELETE /api/definitions/[guid]/share-links/[linkId] — revoke (soft-delete).
 * Idempotent. Authorization gated by `canEditDefinition`.
 *
 * The handler also verifies the link belongs to this definition before
 * revoking — prevents one definition's editor from revoking another's
 * link via a guessed/leaked linkId.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!flag('ENABLE_SHARING')) {
		apiError(
			404,
			ApiErrorCode.NOT_FOUND,
			'Share links are disabled on this instance (ENABLE_SHARING).'
		);
	}
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing GUID');
	const linkParsed = GuidSchema.safeParse(params.linkId);
	if (!linkParsed.success)
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid or missing link ID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		const existing = await providers.data.shareLinks.getById(ctx, linkParsed.data);
		if (!existing || existing.definitionId !== guidParsed.data) {
			// 404 either way — don't leak whether the id exists for a different definition.
			apiError(404, ApiErrorCode.NOT_FOUND, 'Share link not found.');
		}
		await providers.data.shareLinks.revoke(ctx, linkParsed.data);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to revoke share link');
	}
};
