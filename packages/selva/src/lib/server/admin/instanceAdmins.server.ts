import type { Organization, PlatformPermission, RequestContext } from '@selvajs/platform';
import { hasPermission, SYSTEM_CONTEXT, walkPages } from '@selvajs/platform';
import {
	getAuthProvider,
	getOrganizationProvider,
	getPermissionStore
} from '../providers.server.js';
import { orgHasAnotherOwner, serializeOwnerChanges } from '@selvajs/server/handlers';
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
 * Runs `run` once the target is known not to be any org's only usable owner,
 * holding each owned org's member-change queue from the check to the end of
 * `run`. Without the queue, an owner stepping down while their co-owner is
 * deleted each sees the other as the survivor. Per process, like the queue.
 *
 * Erasing or disabling an org's only usable owner would leave nobody who can run
 * it: `canReclaim` needs an org owner or admin, so unlike a project there is no
 * way back. The caller has to hand the org over or delete it first, which is why
 * this refuses rather than picking a successor.
 *
 * Keep `run` short: every owned org's member changes wait on it.
 */
export async function withSoleOwnerGuard<T>(
	targetUserId: string,
	run: () => Promise<T>
): Promise<T> {
	// Sorted, so two guards over the same orgs queue in the same order.
	const owned = (await orgsOwnedBy(targetUserId)).sort((a, b) => a.id.localeCompare(b.id));
	const deps = { orgs: getOrganizationProvider(), auth: getAuthProvider() };
	const guarded = owned.reduceRight<() => Promise<T>>(
		(inner, org) => () => serializeOwnerChanges(org.id, inner),
		async () => {
			for (const org of owned) {
				if (await orgHasAnotherOwner(deps, SYSTEM_CONTEXT, org.id, targetUserId)) continue;
				apiError(
					409,
					ApiErrorCode.CONFLICT,
					`This user is the only owner of ${org.name}. Make someone else an owner, or delete the organization first.`
				);
			}
			return run();
		}
	);
	return guarded();
}

async function orgsOwnedBy(userId: string): Promise<Organization[]> {
	const orgs = getOrganizationProvider();
	const owned: Organization[] = [];
	for await (const page of walkPages((p) => orgs.listOrgs(SYSTEM_CONTEXT, p))) {
		const memberships = await orgs.getOrgMembersFor(
			SYSTEM_CONTEXT,
			page.items.map((o) => o.id),
			userId
		);
		owned.push(...page.items.filter((org) => memberships.get(org.id)?.role === 'owner'));
	}
	return owned;
}
