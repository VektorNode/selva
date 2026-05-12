import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { providers } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { GuidSchema } from '@selvajs/platform/definitions';
import {
	CreateShareLinkInputSchema,
	DEFAULT_SHARE_LINK_MAX_SOLVES,
	type ShareLink
} from '@selvajs/platform';
import { hashToken, mintRawToken } from '$lib/server/shareLinks/token.server';

/**
 * Spec §7 — share-link admin routes.
 *
 * Mint and list/revoke gated by `canEditDefinition` (same authority that
 * uploads versions and publishes). The raw token is returned ONCE in the
 * POST response and never again — list/get only expose tokenHash and
 * usage metadata.
 */

type SafeShareLink = Omit<ShareLink, 'tokenHash'> & { hasToken: true };
function strip(link: ShareLink): SafeShareLink {
	const { tokenHash: _omit, ...rest } = link;
	return { ...rest, hasToken: true };
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	try {
		const page = await providers.data.shareLinks.listByDefinition(ctx, guidParsed.data, {
			limit: 200
		});
		return json({
			links: page.items.map(strip),
			nextCursor: page.nextCursor
		});
	} catch (err) {
		handleApiError(err, 'Failed to list share links');
	}
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const guidParsed = GuidSchema.safeParse(params.guid);
	if (!guidParsed.success) throw error(400, 'Invalid or missing GUID');

	const { ctx } = await requireEditableDefinition(locals, guidParsed.data);

	const body = await request.json().catch(() => ({}));
	const parsed = CreateShareLinkInputSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const raw = mintRawToken();
	const now = new Date().toISOString();
	const link: ShareLink = {
		id: randomUUID(),
		definitionId: guidParsed.data,
		channel: parsed.data.channel,
		tokenHash: hashToken(raw),
		name: parsed.data.name,
		createdBy: locals.user!.id,
		createdAt: now,
		expiresAt: parsed.data.expiresAt ?? null,
		revokedAt: null,
		allowSolve: parsed.data.allowSolve,
		// Default applied only when the field is absent. `null` is a deliberate
		// "uncap" choice and is preserved.
		maxSolves:
			parsed.data.maxSolves === undefined ? DEFAULT_SHARE_LINK_MAX_SOLVES : parsed.data.maxSolves,
		solveCount: 0
	};

	try {
		await providers.data.shareLinks.create(ctx, link);
		// Token returned ONCE — clients must capture it now or revoke + re-mint.
		return json({ link: strip(link), token: raw }, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to create share link');
	}
};
