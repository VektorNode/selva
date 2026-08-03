import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getAuthProvider } from '$lib/server/auth.server';
import { getPermissionStore } from '$lib/server/providers.server';
import { requireManageInstanceUsers } from '$lib/server/access.server';

/**
 * POST /api/admin/users/[id]/disable
 *
 * Permissions.md §10 — disabling a user invalidates sessions while preserving
 * identity and attribution. The §2 sole-`instance_admin` invariant is
 * enforced here BEFORE the auth provider disables, by consulting
 * `IPlatformPermissionStore.countInstanceAdminsExcluding`. Auth providers no
 * longer own Selva-specific authorization.
 *
 * No matching enable endpoint today — the auth interface is one-way for v1.
 * Re-enable lands when the spec defines an explicit re-onboarding flow.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	requireManageInstanceUsers(locals);
	const { id } = params;
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing user ID');

	const targetPerms = await getPermissionStore().getFor(locals.ctx!, id);
	if (targetPerms.includes('instance_admin')) {
		const others = await getPermissionStore().countInstanceAdminsExcluding(locals.ctx!, id);
		if (others === 0) {
			apiError(
				409,
				ApiErrorCode.CONFLICT,
				'Cannot disable the last instance admin. Promote another user to instance admin first.'
			);
		}
	}

	const result = await getAuthProvider().disableUser(id);
	if (result === 'not_found') apiError(404, ApiErrorCode.NOT_FOUND, 'User not found');
	if (result === 'not_supported')
		apiError(501, ApiErrorCode.INTERNAL, 'Disabling users is not supported by this auth provider');

	return new Response(null, { status: 204 });
};
