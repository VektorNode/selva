import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { requireManageUsers } from '$lib/server/access.server';
import { throwZodError } from '$lib/server/api-errors';
import { PermissionSchema } from '@selva/platform';

const UpdatePermissionsBody = z.object({
	permissions: z.array(PermissionSchema)
});

// PATCH — update permissions
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	requireManageUsers(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const body = await request.json().catch(() => null);
	const parsed = UpdatePermissionsBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const ok = await getAuthProvider().updateUserPermissions(id, parsed.data.permissions);
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
