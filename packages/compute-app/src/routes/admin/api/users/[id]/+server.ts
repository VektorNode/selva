import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getAuthProvider } from '$lib/server/auth.server';
import { requireManageUsers } from '$lib/server/access.server';
import type { Permission } from '@selva/platform';
import { ALL_PERMISSIONS } from '@selva/platform';

// PATCH — update permissions
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	requireManageUsers(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { permissions } = body as Record<string, unknown>;
	if (!Array.isArray(permissions) || !permissions.every((p) => ALL_PERMISSIONS.includes(p as Permission))) {
		throw error(400, `permissions must be an array of valid Permission values: ${ALL_PERMISSIONS.join(', ')}`);
	}

	const ok = await getAuthProvider().updateUserPermissions(id, permissions as Permission[]);
	if (!ok) throw error(404, 'User not found or operation not supported');

	return json({ success: true });
};

// DELETE — remove user
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageUsers(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const ok = await getAuthProvider().deleteUser(id);
	if (!ok) throw error(404, 'User not found or operation not supported');

	return json({ success: true });
};
