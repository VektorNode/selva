import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	OrgRoleSchema,
	MEMBER_ASSIGNABLE_PERMISSIONS,
	ALL_ORG_PERMISSIONS,
	type OrgPermission,
	type OrgRole
} from '@selvajs/platform';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireManageOrgMembers } from '$lib/server/access.server';
import { handleApiError, throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';

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

const PERMISSIONS_SCHEMA = z.array(
	z.enum(ALL_ORG_PERMISSIONS as readonly [OrgPermission, ...OrgPermission[]])
);

const PatchSchema = z
	.object({
		role: OrgRoleSchema.optional(),
		permissions: PERMISSIONS_SCHEMA.optional()
	})
	.refine((b) => b.role !== undefined || b.permissions !== undefined, {
		message: 'Provide at least one of role, permissions'
	});

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { orgId, userId } = params;
	if (!orgId || !userId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing org ID or user ID');

	// Owner+admin gate (covers permission edits). Role-change branch adds an
	// extra owner-only gate below.
	requireManageOrgMembers(locals);
	const ctx = locals.ctx!;

	// Tenancy — never trust URL orgId in isolation. The acting context decides
	// which tenant this request applies to.
	if (ctx.actingOrgId !== orgId) {
		apiError(403, ApiErrorCode.FORBIDDEN, 'Acting org does not match the target org.');
	}

	const body = await request.json().catch(() => null);
	const parsed = PatchSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);
	const patch = parsed.data;

	const orgs = getOrganizationProvider();

	// Load actor's role + target's row in parallel.
	const [actorMember, target] = await Promise.all([
		orgs.getOrgMember(ctx, orgId, ctx.userId),
		orgs.getOrgMember(ctx, orgId, userId)
	]);
	if (!target) apiError(404, ApiErrorCode.NOT_FOUND, 'Member not found in this organization.');
	if (!actorMember)
		apiError(403, ApiErrorCode.FORBIDDEN, 'You are not a member of this organization.');

	// Role change branch: owner-only.
	if (patch.role !== undefined && patch.role !== target.role) {
		if (actorMember.role !== 'owner') {
			apiError(403, ApiErrorCode.FORBIDDEN, 'Only the org owner can change roles.');
		}
		// Sole-owner invariant: cannot demote the last owner.
		if (target.role === 'owner' && patch.role !== 'owner') {
			const page = await orgs.listOrgMembers(ctx, orgId, { limit: 200 });
			const otherOwners = page.items.filter(
				(m) => m.role === 'owner' && m.userId !== target.userId && !m.deletedAt
			);
			if (otherOwners.length === 0) {
				apiError(
					409,
					ApiErrorCode.CONFLICT,
					'Cannot demote the sole owner of this organization. Promote another member to owner first.'
				);
			}
		}
		await orgs.updateOrgMemberRole(ctx, orgId, userId, patch.role as OrgRole);
	}

	// Permissions branch.
	if (patch.permissions !== undefined) {
		// After a possible role change, decide what set of permissions is valid.
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
		try {
			await orgs.updateOrgMemberPermissions(ctx, orgId, userId, patch.permissions);
		} catch (err) {
			handleApiError(err, 'Failed to update permissions');
		}
	}

	return new Response(null, { status: 204 });
};
