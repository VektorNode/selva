import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getInviteStore } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import {
	DEFAULT_ORG_PERMISSIONS,
	MEMBER_ASSIGNABLE_PERMISSIONS,
	hasPermission,
	type Invite
} from '@selvajs/platform';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { splitFlatPermissions } from '$lib/server/permissions-compat.server';
import { hashToken, mintRawToken } from '$lib/server/invites/token.server';
import { CreateInviteBodySchema } from '$lib/server/api/v1/bodies';
import { parseListOptions } from '$lib/server/pagination.server';
import { apiRoute, parseBody, shaped, shapedCollection } from '$lib/server/api/v1/route';
import { InviteResponseSchema, CreatedInviteResponseSchema } from '$lib/server/api/v1/responses';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Pending and recently accepted invites for the acting org. */
export const GET: RequestHandler = apiRoute(
	'Failed to list invites',
	async ({ params, locals, url }) => {
		requireManageOrgMembers(locals);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		// `tokenHash` is the server-side lookup key; the response schema drops it.
		return shapedCollection(
			InviteResponseSchema,
			await getInviteStore().listByOrg(ctx, orgId, parseListOptions(url))
		);
	}
);

/** Create an invite and return the accept URL. */
export const POST: RequestHandler = apiRoute(
	'Failed to create invite',
	async ({ params, request, locals, url }) => {
		requireManageOrgMembers(locals);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		const input = await parseBody(request, CreateInviteBodySchema);
		const { platform: submittedPlatformPerms, org: submittedOrgPerms } = splitFlatPermissions(
			input.permissions
		);

		// Same rule as POST /api/admin/users: platform scope is not delegable, so
		// an org admin who can invite members still cannot mint an instance_admin.
		if (submittedPlatformPerms.length > 0 && !hasPermission(locals.ctx!, 'instance_admin')) {
			apiError(
				403,
				ApiErrorCode.FORBIDDEN,
				'Only a platform admin can grant platform-scope permissions'
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

		// The store sees only the digest. The raw token is returned once, inside
		// `acceptUrl`, and never persisted — so a leak of the `invites` table
		// cannot be replayed without the instance secret.
		const rawToken = mintRawToken();
		const now = new Date();
		const invite: Invite = {
			id: randomUUID(),
			tokenHash: hashToken(rawToken),
			email: input.email,
			orgId,
			orgRole: input.orgRole,
			orgPermissions,
			platformPermissions: submittedPlatformPerms,
			invitedBy: locals.user!.id,
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
		};
		await getInviteStore().create(ctx, invite);

		// `acceptUrl` carries the raw token and exists only in this response — it
		// is not a field of the stored invite.
		return shaped(
			CreatedInviteResponseSchema,
			{ ...invite, acceptUrl: `${url.origin}/accept-invite?token=${rawToken}` },
			201
		);
	}
);
