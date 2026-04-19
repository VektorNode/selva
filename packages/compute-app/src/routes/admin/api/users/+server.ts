import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getAuthProvider } from '$lib/server/auth.server';
import { requireManageUsers, throwProviderError } from '$lib/server/access.server';
import type { Permission } from '@selva/platform';
import { ALL_PERMISSIONS } from '@selva/platform';

// GET — list all users
export const GET: RequestHandler = async ({ locals }) => {
	requireManageUsers(locals);
	const page = await getAuthProvider().listUsers({ limit: 200 });
	if (page === null) {
		throw error(
			501,
			'User management is not supported in single-password mode. Configure a users.json path to enable it.'
		);
	}
	return json(page.items);
};

// POST — create a user
export const POST: RequestHandler = async ({ request, locals }) => {
	requireManageUsers(locals);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { email, password, permissions } = body as Record<string, unknown>;

	if (!email || typeof email !== 'string' || !email.includes('@')) {
		throw error(400, 'Valid email is required');
	}
	if (!password || typeof password !== 'string' || password.length < 8) {
		throw error(400, 'Password must be at least 8 characters');
	}
	if (!Array.isArray(permissions) || !permissions.every((p) => ALL_PERMISSIONS.includes(p as Permission))) {
		throw error(400, `permissions must be an array of valid Permission values: ${ALL_PERMISSIONS.join(', ')}`);
	}

	try {
		const user = await getAuthProvider().createUser(email, password, permissions as Permission[]);
		if (user === null) {
			throw error(501, 'User management is not supported in single-password mode.');
		}
		return json(user, { status: 201 });
	} catch (err) {
		throwProviderError(err, 'Failed to create user');
	}
};
