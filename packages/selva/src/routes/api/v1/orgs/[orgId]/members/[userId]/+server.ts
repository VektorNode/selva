import type { RequestHandler } from './$types';
import {
	MEMBER_ASSIGNABLE_PERMISSIONS,
	ALL_ORG_PERMISSIONS,
	type OrgPermission,
	type OrgRole,
	type RequestContext
} from '@selvajs/platform';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { UpdateOrgMemberBodySchema } from '$lib/server/api/v1/bodies';
import { apiRoute, noContent, parseBody, requireParams } from '$lib/server/api/v1/route';

/**
 * PATCH /api/orgs/[orgId]/members/[userId]
 *
 * Body accepts either or both:
 *   - `{ role: OrgRole }` — change the member's role. **Owner-only** per §3.
 *   - `{ permissions: OrgPermission[] }` — replace the member's grantable
 *     permissions. Owner/admin via `manage_org_members`. For `member`-role
 *     targets, only `MEMBER_ASSIGNABLE_PERMISSIONS` are accepted; promoting a
 *     member's permissions does NOT change their role (that's a separate
 *     branch, owner-only).
 *
 * Tenancy: the URL `orgId` must equal `ctx.actingOrgId`. Cross-org member
 * mutation is blocked even if the actor holds permissions in another org.
 *
 * Self-protection (sole-owner invariant, §10 spirit): the only owner of an
 * org cannot be demoted. Demoting yourself while you are the sole owner is
 * the most common way to discover this — handler returns 409.
 */

/**
 * Whether anyone other than `exceptUserId` still owns the org.
 *
 * Both branches below need this and both used to scan the roster themselves —
 * the sole-owner invariant is one rule, so it reads from one place.
 */
async function hasAnotherOwner(
	ctx: RequestContext,
	orgId: string,
	exceptUserId: string
): Promise<boolean> {
	const page = await getOrganizationProvider().listOrgMembers(ctx, orgId, { limit: 200 });
	return page.items.some((m) => m.role === 'owner' && m.userId !== exceptUserId && !m.deletedAt);
}

export const PATCH: RequestHandler = apiRoute(
	'Failed to update member',
	async ({ params, request, locals }) => {
		const { userId } = requireParams(params, 'orgId', 'userId');

		// Owner+admin gate, covering permission edits. The role-change branch adds
		// an owner-only gate below.
		requireManageOrgMembers(locals);
		// Tenancy — the acting context decides which tenant this applies to, never
		// the URL alone.
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		const patch = await parseBody(request, UpdateOrgMemberBodySchema);
		const orgs = getOrganizationProvider();

		const [actorMember, target] = await Promise.all([
			orgs.getOrgMember(ctx, orgId, ctx.userId),
			orgs.getOrgMember(ctx, orgId, userId)
		]);
		if (!target) apiError(404, ApiErrorCode.NOT_FOUND, 'Member not found in this organization.');
		if (!actorMember) {
			apiError(403, ApiErrorCode.FORBIDDEN, 'You are not a member of this organization.');
		}

		if (patch.role !== undefined && patch.role !== target.role) {
			if (actorMember.role !== 'owner') {
				apiError(403, ApiErrorCode.FORBIDDEN, 'Only the org owner can change roles.');
			}
			if (
				target.role === 'owner' &&
				patch.role !== 'owner' &&
				!(await hasAnotherOwner(ctx, orgId, target.userId))
			) {
				apiError(
					409,
					ApiErrorCode.CONFLICT,
					'Cannot demote the sole owner of this organization. Promote another member to owner first.'
				);
			}
			await orgs.updateOrgMemberRole(ctx, orgId, userId, patch.role as OrgRole);
		}

		if (patch.permissions !== undefined) {
			// Validate against the role the member will have, not the one they had.
			const effectiveRole: OrgRole = patch.role ?? target.role;
			const valid =
				effectiveRole === 'member'
					? new Set<OrgPermission>(MEMBER_ASSIGNABLE_PERMISSIONS)
					: new Set<OrgPermission>(ALL_ORG_PERMISSIONS);
			const invalid = patch.permissions.filter((p) => !valid.has(p));
			if (invalid.length > 0) {
				apiError(
					400,
					ApiErrorCode.VALIDATION_FAILED,
					`Permissions [${invalid.join(', ')}] cannot be assigned to a ${effectiveRole}.`
				);
			}
			await orgs.updateOrgMemberPermissions(ctx, orgId, userId, patch.permissions);
		}

		return noContent();
	}
);

/**
 * Remove a member from the org. Owner/admin via `manage_org_members`, same
 * tenancy check as PATCH, and the same sole-owner invariant — removing the last
 * owner would leave the org unadministrable.
 */
export const DELETE: RequestHandler = apiRoute(
	'Failed to remove member',
	async ({ params, locals }) => {
		const { userId } = requireParams(params, 'orgId', 'userId');
		requireManageOrgMembers(locals);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		const orgs = getOrganizationProvider();
		const target = await orgs.getOrgMember(ctx, orgId, userId);
		if (!target) apiError(404, ApiErrorCode.NOT_FOUND, 'Member not found in this organization.');

		if (target.role === 'owner' && !(await hasAnotherOwner(ctx, orgId, target.userId))) {
			apiError(
				409,
				ApiErrorCode.CONFLICT,
				'Cannot remove the sole owner of this organization. Promote another member to owner first.'
			);
		}

		await orgs.removeOrgMember(ctx, orgId, userId);
		return noContent();
	}
);
