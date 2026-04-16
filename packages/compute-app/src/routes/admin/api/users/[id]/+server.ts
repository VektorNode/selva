import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getAuthProvider } from '$lib/server/auth.server';
import type { UserRole } from '@selva/platform/auth';

const VALID_ROLES: UserRole[] = ['admin', 'editor', 'viewer'];

// PATCH — update role
export const PATCH: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { role } = body as Record<string, unknown>;
	if (!role || !VALID_ROLES.includes(role as UserRole)) {
		throw error(400, `Role must be one of: ${VALID_ROLES.join(', ')}`);
	}

	const ok = await getAuthProvider().updateUserRole(id, role as UserRole);
	if (!ok) throw error(404, 'User not found or operation not supported');

	return json({ success: true });
};

// DELETE — remove user
export const DELETE: RequestHandler = async ({ params }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const ok = await getAuthProvider().deleteUser(id);
	if (!ok) throw error(404, 'User not found or operation not supported');

	return json({ success: true });
};
