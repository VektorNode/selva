import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getInviteStore } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, requireParams, shaped } from '$lib/server/api/v1/route';
import { hashToken, mintRawToken } from '$lib/server/invites/token.server';
import { deliverInvite } from '$lib/server/invites/deliver.server';
import { findPendingInviteInOrg } from '$lib/server/invites/lookup.server';
import { CreatedInviteResponseSchema } from '$lib/server/api/v1/responses';
import type { Invite } from '@selvajs/platform';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Re-send an invite: mint a replacement and revoke the original.
 *
 * A resend cannot reuse the original link. The raw token is never stored — only
 * its HMAC digest is — so there is nothing to re-read, and rather than weaken
 * that, this issues a fresh token and revokes the row it replaces. The old link
 * stops working the moment this returns, which is also what an admin wants
 * after mailing an invite to the wrong address.
 *
 * Grants are copied verbatim from the original. The role and permission gates
 * ran when it was minted; re-deriving them here would let a since-demoted admin
 * silently change what the invite carries.
 */
export const POST: RequestHandler = apiRoute(
	'Failed to resend invite',
	async ({ params, locals, url }) => {
		requireManageOrgMembers(locals);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);
		const { id } = requireParams(params, 'id');

		const existing = await findPendingInviteInOrg(ctx, orgId, id);
		if (!existing) apiError(404, ApiErrorCode.NOT_FOUND, 'Invite not found');
		if (existing.acceptedAt) {
			apiError(409, ApiErrorCode.CONFLICT, 'This invite has already been accepted.');
		}

		const rawToken = mintRawToken();
		const now = new Date();
		const replacement: Invite = {
			...existing,
			id: randomUUID(),
			tokenHash: hashToken(rawToken),
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
		};

		// Create before revoking: if the revoke fails the invitee holds a working
		// link, whereas the reverse order can leave them with none at all.
		await getInviteStore().create(ctx, replacement);
		await getInviteStore().revoke(ctx, existing.id);

		const acceptUrl = `${url.origin}/accept-invite?token=${rawToken}`;
		const delivery = await deliverInvite({
			ctx,
			log: locals.log,
			invite: replacement,
			acceptUrl,
			actor: { profile: locals.profile, user: locals.user }
		});

		return shaped(CreatedInviteResponseSchema, { ...replacement, acceptUrl, delivery }, 201);
	}
);
