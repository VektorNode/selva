/**
 * Share-link administration.
 *
 * Minting, listing and revoking are gated by `canEditDefinition` — the same
 * authority that uploads versions and publishes. The raw token appears in the
 * POST response and nowhere else; everything afterwards sees `hasToken: true`.
 *
 * **Responses go through `shaped`/`shapedCollection`, never `{ body }`.** A
 * `ShareLink` carries `tokenHash`, and the response schema is what drops it —
 * returning the record directly would put a credential hash on the wire with
 * nothing failing at build time.
 */

import { randomUUID } from 'node:crypto';
import {
	apiError,
	ApiErrorCode,
	CreatedShareLinkResponseSchema,
	noContent,
	parseBody,
	parseListOptions,
	parseParam,
	requireCaller,
	shaped,
	shapedCollection,
	ShareLinkResponseSchema
} from '../api/index.js';
import type { ApiHandler, ApiRequest } from '../api/index.js';
import { CreateShareLinkInputSchema, DEFAULT_SHARE_LINK_MAX_SOLVES } from '@selvajs/platform';
import type { ShareLink } from '@selvajs/platform';
import { GuidSchema } from '@selvajs/platform/definitions';
import { requireEditableDefinition } from '../access/index.js';
import { tokenCodec } from './services.js';

function assertSharingEnabled(req: ApiRequest) {
	if (!req.deps.flag('ENABLE_SHARING')) {
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

export const listShareLinks: ApiHandler = async (req) => {
	assertSharingEnabled(req);
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx } = await requireEditableDefinition(req, guid);

	const page = await req.deps.shareLinks.listByDefinition(ctx, guid, parseListOptions(req.url));
	return shapedCollection(ShareLinkResponseSchema, {
		items: page.items.map(forClient),
		nextCursor: page.nextCursor
	});
};

export const createShareLink: ApiHandler = async (req) => {
	assertSharingEnabled(req);
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { user } = requireCaller(req);
	const { ctx } = await requireEditableDefinition(req, guid);

	const input = await parseBody(req.request, CreateShareLinkInputSchema, { missingAs: {} });

	const codec = tokenCodec(req.deps, 'shareLinks');
	const raw = codec.mintRawToken();
	const link: ShareLink = {
		id: randomUUID(),
		definitionId: guid,
		channel: input.channel,
		tokenHash: codec.hashToken(raw),
		name: input.name,
		createdBy: user.id,
		createdAt: new Date().toISOString(),
		expiresAt: input.expiresAt ?? null,
		revokedAt: null,
		allowSolve: input.allowSolve,
		// The default applies only when the field is absent. An explicit `null`
		// is a deliberate "uncap" choice and is preserved.
		maxSolves: input.maxSolves === undefined ? DEFAULT_SHARE_LINK_MAX_SOLVES : input.maxSolves,
		solveCount: 0
	};

	await req.deps.shareLinks.create(ctx, link);
	// The token is returned once — a client that loses it must revoke and re-mint.
	return shaped(CreatedShareLinkResponseSchema, { link: forClient(link), token: raw }, 201);
};

/**
 * Revoke a share link (soft-delete). Idempotent, gated by `canEditDefinition`.
 *
 * The link must belong to this definition, so one definition's editor cannot
 * revoke another's link with a guessed or leaked linkId.
 */
export const revokeShareLink: ApiHandler = async (req) => {
	assertSharingEnabled(req);
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const linkId = parseParam(req.params.linkId, GuidSchema, 'link ID');

	const { ctx } = await requireEditableDefinition(req, guid);

	const existing = await req.deps.shareLinks.getById(ctx, linkId);
	if (!existing || existing.definitionId !== guid) {
		// 404 either way — never disclose that the id exists on another definition.
		apiError(404, ApiErrorCode.NOT_FOUND, 'Share link not found.');
	}
	await req.deps.shareLinks.revoke(ctx, linkId);
	return noContent();
};
