/**
 * Org invites: list, mint, revoke, resend.
 *
 * **The raw token exists only in the response.** The store sees an HMAC digest,
 * so a leak of the `invites` table cannot be replayed without the instance
 * secret — and `tokenHash` is dropped by the response schema, which is why
 * every response here goes through `shaped`/`shapedCollection` rather than
 * `{ body }`.
 */

import { randomUUID } from 'node:crypto';
import {
	apiError,
	ApiErrorCode,
	noContent,
	parseBody,
	requireParams,
	shaped,
	shapedCollection
} from '@selvajs/server/api';
import type { ApiHandler } from '@selvajs/server/api';
import {
	DEFAULT_ORG_PERMISSIONS,
	MEMBER_ASSIGNABLE_PERMISSIONS,
	type Invite
} from '@selvajs/platform';
import {
	assertCanGrantPlatformPermissions,
	canActorChangeOrgRole,
	requireManageOrgMembers,
	requireActingOrg
} from '../../access.server';
import { splitFlatPermissions } from '../../permissions-scope.server';
import { tokenCodec } from './services';
import { deliverInvite } from '../../invites/deliver.server';
import { findPendingInviteInOrg } from '../../invites/lookup.server';
import { parseListOptions } from '../../pagination.server';
import { CreateInviteBodySchema } from '../v1/bodies';
import { InviteResponseSchema, CreatedInviteResponseSchema } from '../v1/responses';
import { requireCaller } from '../callers';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Pending and recently accepted invites for the acting org. */
export const listInvites: ApiHandler = async (req) => {
	requireManageOrgMembers(req);
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);

	// `tokenHash` is the server-side lookup key; the response schema drops it.
	return shapedCollection(
		InviteResponseSchema,
		await req.deps.invites.listByOrg(ctx, orgId, parseListOptions(req.url))
	);
};

/** Create an invite and return the accept URL. */
export const createInvite: ApiHandler = async (req) => {
	requireManageOrgMembers(req);
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);
	const { user } = requireCaller(req);

	const input = await parseBody(req.request, CreateInviteBodySchema);
	const { platform: submittedPlatformPerms, org: submittedOrgPerms } = splitFlatPermissions(
		input.permissions
	);

	// An invite is a third write path into platform scope, so it shares the
	// guard with both /api/admin/users handlers rather than restating it.
	assertCanGrantPlatformPermissions(ctx, submittedPlatformPerms);

	// An invite is a second door into `org_members`, so it carries the same
	// owner-only role gate as PATCH /orgs/{orgId}/members/{userId}. Without
	// it an admin mints themselves an `owner` invite, accepts it, and then
	// passes the sole-owner check when removing the founder — `accept-invite`
	// writes `invite.orgRole` verbatim and cannot re-verify the minter.
	if (!(await canActorChangeOrgRole(ctx, orgId, input.orgRole, req))) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'Only the org owner can invite someone as owner or admin.'
		);
	}

	// owner/admin always carry the full set — the checkbox array from the UI is
	// ignored for those roles. `member` takes the caller's selection intersected
	// with MEMBER_ASSIGNABLE_PERMISSIONS, so governance permissions
	// (manage_org_members, manage_org_compute) cannot be granted to a member.
	const orgPermissions =
		input.orgRole === 'member'
			? submittedOrgPerms.filter((p) => MEMBER_ASSIGNABLE_PERMISSIONS.includes(p))
			: [...DEFAULT_ORG_PERMISSIONS[input.orgRole]];

	const codec = tokenCodec(req.deps, 'invites');
	const rawToken = codec.mintRawToken();
	const now = new Date();
	const invite: Invite = {
		id: randomUUID(),
		tokenHash: codec.hashToken(rawToken),
		email: input.email,
		orgId,
		orgRole: input.orgRole,
		orgPermissions,
		platformPermissions: submittedPlatformPerms,
		invitedBy: user.id,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
	};
	await req.deps.invites.create(ctx, invite);

	// `acceptUrl` carries the raw token and exists only in this response — it
	// is not a field of the stored invite.
	const acceptUrl = `${req.url.origin}/accept-invite?token=${rawToken}`;
	const delivery = await deliverInvite({
		ctx,
		log: req.log,
		invite,
		acceptUrl,
		actor: { profile: req.profile, user: req.user }
	});

	return shaped(CreatedInviteResponseSchema, { ...invite, acceptUrl, delivery }, 201);
};

/** Revoke a pending invite. Consumed invites are preserved for audit. */
export const revokeInvite: ApiHandler = async (req) => {
	requireManageOrgMembers(req);
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);
	const { id } = requireParams(req.params, 'id');

	if (!(await findPendingInviteInOrg(ctx, orgId, id, req.deps.invites))) {
		apiError(404, ApiErrorCode.NOT_FOUND, 'Invite not found');
	}
	await req.deps.invites.revoke(ctx, id);
	return noContent();
};

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
export const resendInvite: ApiHandler = async (req) => {
	requireManageOrgMembers(req);
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);
	const { id } = requireParams(req.params, 'id');

	const existing = await findPendingInviteInOrg(ctx, orgId, id, req.deps.invites);
	if (!existing) apiError(404, ApiErrorCode.NOT_FOUND, 'Invite not found');
	if (existing.acceptedAt) {
		apiError(409, ApiErrorCode.CONFLICT, 'This invite has already been accepted.');
	}

	const codec = tokenCodec(req.deps, 'invites');
	const rawToken = codec.mintRawToken();
	const now = new Date();
	const replacement: Invite = {
		...existing,
		id: randomUUID(),
		tokenHash: codec.hashToken(rawToken),
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
	};

	// Create before revoking: if the revoke fails the invitee holds a working
	// link, whereas the reverse order can leave them with none at all.
	await req.deps.invites.create(ctx, replacement);
	await req.deps.invites.revoke(ctx, existing.id);

	const acceptUrl = `${req.url.origin}/accept-invite?token=${rawToken}`;
	const delivery = await deliverInvite({
		ctx,
		log: req.log,
		invite: replacement,
		acceptUrl,
		actor: { profile: req.profile, user: req.user }
	});

	return shaped(CreatedInviteResponseSchema, { ...replacement, acceptUrl, delivery }, 201);
};
