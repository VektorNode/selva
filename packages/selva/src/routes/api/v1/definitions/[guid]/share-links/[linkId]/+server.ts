import type { RequestHandler } from './$types';
import { providers, flag } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import { apiRoute, noContent, parseParam } from '$lib/server/api/v1/route';

/**
 * Revoke a share link (soft-delete). Idempotent, gated by `canEditDefinition`.
 *
 * The link must belong to this definition, so one definition's editor cannot
 * revoke another's link with a guessed or leaked linkId.
 */
export const DELETE: RequestHandler = apiRoute(
	'Failed to revoke share link',
	async ({ params, locals }) => {
		if (!flag('ENABLE_SHARING')) {
			apiError(
				404,
				ApiErrorCode.NOT_FOUND,
				'Share links are disabled on this instance (ENABLE_SHARING).'
			);
		}
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const linkId = parseParam(params.linkId, GuidSchema, 'link ID');

		const { ctx } = await requireEditableDefinition(locals, guid);

		const existing = await providers.data.shareLinks.getById(ctx, linkId);
		if (!existing || existing.definitionId !== guid) {
			// 404 either way — never disclose that the id exists on another definition.
			apiError(404, ApiErrorCode.NOT_FOUND, 'Share link not found.');
		}
		await providers.data.shareLinks.revoke(ctx, linkId);
		return noContent();
	}
);
