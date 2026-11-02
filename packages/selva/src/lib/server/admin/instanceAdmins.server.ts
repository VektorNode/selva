import type { PlatformPermission, RequestContext } from '@selvajs/platform';
import { hasPermission, SYSTEM_CONTEXT, walkPages } from '@selvajs/platform';
import {
	getAuthProvider,
	getOrganizationProvider,
	getPermissionStore
} from '../providers.server.js';
import { apiError, ApiErrorCode } from '../api-errors.js';

/**
 * Shared preconditions for the two routes that remove an instance admin's
 * access — `DELETE /api/admin/users/[id]` and its `disable` sibling. Both used
 * to carry their own copy; the copies agreed, which is exactly how they would
 * have drifted.
 *
 * `verb` is spliced into the 409 message ("Cannot delete/disable the last…").
 */
export async function requireCanRemoveInstanceAdmin(
	ctx: RequestContext,
	targetUserId: string,
	verb: 'delete' | 'disable'
): Promise<{ targetIsAdmin: boolean }> {
	const targetPerms = await getPermissionStore().getFor(ctx, targetUserId);
	const targetIsAdmin = targetPerms.includes('instance_admin');
	if (!targetIsAdmin) return { targetIsAdmin };

	// Same rationale as PATCH /api/admin/users/[id]: removing an admin's access
	// is a platform-scope permission change, so `manage_instance_users` alone
	// must not authorize it — otherwise an org admin holding that permission
	// could remove the admins above them.
	if (!hasPermission(ctx, 'instance_admin')) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			`Only a platform admin can ${verb} another platform admin.`
		);
	}

	const others = await getPermissionStore().countInstanceAdminsExcluding(ctx, targetUserId);
	if (others === 0) {
		apiError(
			409,
			ApiErrorCode.CONFLICT,
			`Cannot ${verb} the last instance admin. Promote another user to instance admin first.`
		);
	}

	return { targetIsAdmin };
}

/**
 * A disabled admin counts as an admin but cannot sign in. The last enabled admin
 * could then be removed, `/setup` would stay closed, and no endpoint re-enables a
 * user, which locks the instance.
 */
export async function requireEnabledToBecomeAdmin(
	targetUserId: string,
	next: readonly PlatformPermission[],
	existing: readonly PlatformPermission[]
): Promise<void> {
	if (!next.includes('instance_admin') || existing.includes('instance_admin')) return;
	const target = await getAuthProvider().getUser(targetUserId);
	if (target?.disabled) {
		apiError(409, ApiErrorCode.CONFLICT, 'A disabled user cannot become an instance admin.');
	}
}

/**
 * Erasing an org's only owner would leave nobody who can run it: `canReclaim`
 * needs an org owner or admin, so unlike a project there is no way back. The
 * caller has to hand the org over or delete it first, which is why this refuses
 * rather than picking a successor.
 */
export async function requireNotSoleOrgOwner(targetUserId: string): Promise<void> {
	const orgs = getOrganizationProvider();
	for await (const page of walkPages((p) => orgs.listOrgs(SYSTEM_CONTEXT, p))) {
		const memberships = await orgs.getOrgMembersFor(
			SYSTEM_CONTEXT,
			page.items.map((o) => o.id),
			targetUserId
		);
		for (const org of page.items) {
			if (memberships.get(org.id)?.role !== 'owner') continue;
			if (await orgHasAnotherOwner(org.id, targetUserId)) continue;
			apiError(
				409,
				ApiErrorCode.CONFLICT,
				`This user is the only owner of ${org.name}. Make someone else an owner, or delete the organization first.`
			);
		}
	}
}

async function orgHasAnotherOwner(orgId: string, exceptUserId: string): Promise<boolean> {
	const orgs = getOrganizationProvider();
	for await (const page of walkPages((p) => orgs.listOrgMembers(SYSTEM_CONTEXT, orgId, p))) {
		if (page.items.some((m) => m.role === 'owner' && m.userId !== exceptUserId)) return true;
	}
	return false;
}
