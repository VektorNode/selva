import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getAuthProvider } from '$lib/server/auth.server';
import { requireManageInstanceUsers } from '$lib/server/access.server';

/**
 * POST /admin/api/users/[id]/disable
 *
 * Permissions.md §10 — disabling a user invalidates sessions while preserving
 * identity and attribution. Preferred over deletion for offboarding. The §2
 * sole-`instance_admin` invariant is enforced at the auth provider; a 409
 * surfaces here when the operation would leave zero enabled instance admins.
 *
 * No matching enable endpoint today — the auth interface is one-way for v1.
 * Re-enable lands when the spec defines an explicit re-onboarding flow.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	requireManageInstanceUsers(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const result = await getAuthProvider().disableUser(id);
	if (result === 'not_found') throw error(404, 'User not found');
	if (result === 'not_supported')
		throw error(501, 'Disabling users is not supported by this auth provider');
	if (result === 'last_admin')
		throw error(
			409,
			'Cannot disable the last instance admin. Promote another user to instance admin first.'
		);

	return json({ success: true });
};
