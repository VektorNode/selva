import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { providers, flag } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import { CreateShareLinkInputSchema, DEFAULT_SHARE_LINK_MAX_SOLVES } from '@selvajs/platform';
import type { ShareLink } from '@selvajs/platform';
import { hashToken, mintRawToken } from '$lib/server/shareLinks/token.server';
import { parseListOptions } from '$lib/server/pagination.server';
import {
	apiRoute,
	parseBody,
	parseParam,
	shaped,
	shapedCollection
} from '$lib/server/api/v1/route';
import {
	ShareLinkResponseSchema,
	CreatedShareLinkResponseSchema
} from '$lib/server/api/v1/responses';

/**
 * Share-link administration.
 *
 * Minting, listing and revoking are gated by `canEditDefinition` — the same
 * authority that uploads versions and publishes. The raw token appears in the
 * POST response and nowhere else; everything afterwards sees `hasToken: true`.
 */

function assertSharingEnabled() {
	if (!flag('ENABLE_SHARING')) {
		apiError(
			404,
			ApiErrorCode.NOT_FOUND,
			'Share links are disabled on this instance (ENABLE_SHARING).'
		);
	}
}

/** `tokenHash` is dropped by the response schema, not by this function. */
function forClient(link: ShareLink) {
	return { ...link, hasToken: true as const };
}

export const GET: RequestHandler = apiRoute(
	'Failed to list share links',
	async ({ params, locals, url }) => {
		assertSharingEnabled();
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const { ctx } = await requireEditableDefinition(locals, guid);

		const page = await providers.data.shareLinks.listByDefinition(ctx, guid, parseListOptions(url));
		return shapedCollection(ShareLinkResponseSchema, {
			items: page.items.map(forClient),
			nextCursor: page.nextCursor
		});
	}
);

export const POST: RequestHandler = apiRoute(
	'Failed to create share link',
	async ({ params, request, locals }) => {
		assertSharingEnabled();
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const { ctx } = await requireEditableDefinition(locals, guid);

		const input = await parseBody(request, CreateShareLinkInputSchema, { missingAs: {} });

		const raw = mintRawToken();
		const link: ShareLink = {
			id: randomUUID(),
			definitionId: guid,
			channel: input.channel,
			tokenHash: hashToken(raw),
			name: input.name,
			createdBy: locals.user!.id,
			createdAt: new Date().toISOString(),
			expiresAt: input.expiresAt ?? null,
			revokedAt: null,
			allowSolve: input.allowSolve,
			// The default applies only when the field is absent. An explicit `null`
			// is a deliberate "uncap" choice and is preserved.
			maxSolves: input.maxSolves === undefined ? DEFAULT_SHARE_LINK_MAX_SOLVES : input.maxSolves,
			solveCount: 0
		};

		await providers.data.shareLinks.create(ctx, link);
		// The token is returned once — a client that loses it must revoke and re-mint.
		return shaped(CreatedShareLinkResponseSchema, { link: forClient(link), token: raw }, 201);
	}
);
