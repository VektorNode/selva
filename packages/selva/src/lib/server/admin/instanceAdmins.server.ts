import type { RequestContext } from '@selvajs/platform';
import { hasPermission } from '@selvajs/platform';
import { getPermissionStore } from '../providers.server.js';
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
