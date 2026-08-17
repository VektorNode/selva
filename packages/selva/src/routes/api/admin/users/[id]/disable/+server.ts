import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, noContent, requireParams } from '$lib/server/api/http';
import { getAuthProvider } from '$lib/server/auth.server';
import { requireManageInstanceUsers } from '$lib/server/access.server';
import { requireCanRemoveInstanceAdmin } from '$lib/server/admin/instanceAdmins.server';
import { setUserPlatformPermissions } from '$lib/server/permissions.server';
import { getEventSink } from '$lib/server/providers.server';
import { actorFrom } from '@selvajs/platform';

/**
 * POST /api/admin/users/[id]/disable
 *
 * Permissions.md §10 — disable preserves identity and attribution. The §2
 * sole-`instance_admin` invariant is enforced here BEFORE the auth provider
 * disables, by consulting
 * `IPlatformPermissionStore.countInstanceAdminsExcluding`. Auth providers no
 * longer own Selva-specific authorization.
 *
 * Cutoff is not instant on every provider, and this route cannot make it so:
 * `sessionRefresh.revokeSession` takes the target's session token, which an
 * admin disabling someone else does not hold. Local and header-auth re-read the
 * user each request, so they cut off on the next one. Supabase keeps accepting
 * an already-issued access token until `revalidateMs` (default 60s) — but its
 * `refreshSession` rejects disabled users, so nothing new can be minted and the
 * window is bounded by the access token's own lifetime, not the 30-day refresh
 * token.
 *
 * No matching enable endpoint today — the auth interface is one-way for v1.
 * Re-enable lands when the spec defines an explicit re-onboarding flow.
 */
export const POST: RequestHandler = apiRoute(
	'Failed to disable user',
	async ({ params, locals }) => {
		requireManageInstanceUsers(locals);
		const { id } = requireParams(params, 'id');

		const { targetIsAdmin } = await requireCanRemoveInstanceAdmin(locals.ctx!, id, 'disable');

		// Revoke before disabling. The local permission store cannot see the
		// disabled flag (it lives in the auth provider's file), so a disabled admin
		// still counts as live there — disable two admins in a row and the instance
		// reaches zero enabled admins with both checks having passed.
		//
		// Re-enabling does not restore the grant; an admin re-assigns it.
		if (targetIsAdmin) {
			const revoked = await setUserPlatformPermissions(locals.ctx!, id, []);
			if (revoked === 'last_admin') {
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
			apiError(
				501,
				ApiErrorCode.INTERNAL,
				'Disabling users is not supported by this auth provider'
			);

		await getEventSink().emit({
			type: 'user.disabled',
			userId: id,
			actorId: actorFrom(locals.ctx!)
		});

		return noContent();
	}
);
