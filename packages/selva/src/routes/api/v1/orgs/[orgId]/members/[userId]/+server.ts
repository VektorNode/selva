import type { RequestHandler } from './$types';
import {
	MEMBER_ASSIGNABLE_PERMISSIONS,
	ALL_ORG_PERMISSIONS,
	actorFrom,
	canChangeOrgRole,
	type OrgPermission,
	type OrgRole,
	type Project,
	type RequestContext
} from '@selvajs/platform';
import {
	getAuthProvider,
	getEventSink,
	getInviteStore,
	getLogger,
	getOrganizationProvider,
	getProjectProvider
} from '$lib/server/providers.server';
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

const ROSTER_PAGE_LIMIT = 200;
// Runaway guard against an adapter returning a non-advancing cursor. Matches
// `listAllOrgMembers`; 100 pages is 20k members, past any real org here.
const MAX_ROSTER_PAGES = 100;

/**
 * Whether anyone other than `exceptUserId` still owns the org.
 *
 * Both branches below need this and both used to scan the roster themselves —
 * the sole-owner invariant is one rule, so it reads from one place.
 *
 * Pages rather than reading one 200-row window: a second owner sitting past the
 * first page read as "no other owner", so the invariant refused a demotion or
 * removal that was in fact safe. That failed closed, but it made the org
 * unadministrable exactly when it had grown enough to need administering.
 * Returns on the first owner found, so the common case is still one round-trip.
 */
async function hasAnotherOwner(
	ctx: RequestContext,
	orgId: string,
	exceptUserId: string
): Promise<boolean> {
	const orgs = getOrganizationProvider();
	let cursor: string | undefined;
	for (let page = 0; page < MAX_ROSTER_PAGES; page++) {
		const result = await orgs.listOrgMembers(ctx, orgId, { limit: ROSTER_PAGE_LIMIT, cursor });
		if (result.items.some((m) => m.role === 'owner' && m.userId !== exceptUserId && !m.deletedAt)) {
			return true;
		}
		cursor = result.nextCursor;
		if (!cursor) return false;
	}
	// Cap hit without finding one: report "no other owner" so the caller refuses.
	// Failing closed on an incomplete read is the safe direction for an invariant
	// whose whole job is preventing an unadministrable org.
	getLogger().warn('hasAnotherOwner hit the page cap — treating as sole owner', {
		orgId,
		pages: MAX_ROSTER_PAGES
	});
	return false;
}

/**
 * Projects in `orgId` where `userId` is the only live owner — the ones that
 * will have no owner once `removeOrgMember` cascades their membership rows.
 *
 * **Decided (2026-08-17): report, do not block.** §10 said removal should be
 * blocked until a new owner is assigned, and that rule is being retired rather
 * than implemented. Blocking puts an unbounded chore in front of offboarding —
 * the cost scales with how many projects the departing person owned, which is
 * backwards, because the most prolific people are the ones whose departure most
 * needs to be clean. An offboarding that fails halfway is worse than an
 * ownerless project: the person stays in the org while someone works through
 * the backlog. Reclaim (§5) already exists to adopt an ownerless project, so
 * the recovery path is built; what was missing was any signal that recovery was
 * needed. Hence the event.
 *
 * MUST be called before the removal — afterwards the rows it reads are gone.
 */
async function findProjectsLosingSoleOwner(
	ctx: RequestContext,
	orgId: string,
	userId: string
): Promise<Project[]> {
	const projects = getProjectProvider();
	const orgProjects = await projects.listProjects(ctx, orgId, { limit: ROSTER_PAGE_LIMIT });

	const checks = await Promise.all(
		orgProjects.items.map(async (project) => {
			const members = await projects.listProjectMembers(ctx, project.id, {
				limit: ROSTER_PAGE_LIMIT
			});
			const owners = members.items.filter((m) => m.role === 'owner' && !m.deletedAt);
			return owners.length === 1 && owners[0].userId === userId ? project : null;
		})
	);

	return checks.filter((p): p is Project => p !== null);
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
			// Gated on both the role being granted and the one being taken away —
			// demoting an owner is an owner-only act even though `member` is not.
			if (
				!canChangeOrgRole({ actorMember, role: patch.role }) ||
				!canChangeOrgRole({ actorMember, role: target.role })
			) {
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
		const [actorMember, target] = await Promise.all([
			orgs.getOrgMember(ctx, orgId, ctx.userId),
			orgs.getOrgMember(ctx, orgId, userId)
		]);
		if (!target) apiError(404, ApiErrorCode.NOT_FOUND, 'Member not found in this organization.');

		// Same owner-only gate PATCH applies to demotion (§3). Removing an owner
		// ends their role just as demoting them does, so an admin got 403 on the
		// demote and 204 on the remove — the harder-to-reverse of the two.
		if (!canChangeOrgRole({ actorMember, role: target.role })) {
			apiError(403, ApiErrorCode.FORBIDDEN, 'Only the org owner can remove another owner.');
		}

		if (target.role === 'owner' && !(await hasAnotherOwner(ctx, orgId, target.userId))) {
			apiError(
				409,
				ApiErrorCode.CONFLICT,
				'Cannot remove the sole owner of this organization. Promote another member to owner first.'
			);
		}

		// Must run before the removal: the cascade soft-deletes the very rows this
		// reads. Reported, not blocked — see the docblock on `findProjectsLosingSoleOwner`.
		const orphaned = await findProjectsLosingSoleOwner(ctx, orgId, userId);

		await orgs.removeOrgMember(ctx, orgId, userId);

		if (orphaned.length > 0) {
			await getEventSink().emit({
				type: 'org_member.removed_orphaning_projects',
				orgId,
				userId,
				projectIds: orphaned.map((p) => p.id),
				actorId: actorFrom(ctx)
			});
			getLogger().warn('Org member removal left projects without an owner', {
				orgId,
				userId,
				actorId: ctx.userId,
				projectCount: orphaned.length
			});
		}

		// `removeOrgMember` cascades `project_members` but not invites, so a
		// dormant invite would let the removed user walk straight back in at
		// their original role. Best-effort: the removal itself has committed, and
		// failing the request now would report an offboarding that did happen as
		// one that didn't. A failure here leaves a live re-entry path, so it is
		// logged rather than swallowed.
		const email = (await getAuthProvider().getUser(userId))?.email;
		if (email) {
			try {
				await getInviteStore().revokePendingByEmail(ctx, orgId, email);
			} catch (err) {
				getLogger().error('Removed org member but failed to revoke their pending invites', {
					orgId,
					userId,
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}

		return noContent();
	}
);
