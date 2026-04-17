import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getAuthProvider } from '$lib/server/auth.server';
import type { UserRole } from '@selva/platform/auth';

const VALID_ROLES: UserRole[] = ['platform_admin', 'user'];

// GET — list all users
export const GET: RequestHandler = async () => {
	const users = await getAuthProvider().listUsers();
	if (users === null) {
		throw error(501, 'User management is not supported in single-password mode. Configure a users.json path to enable it.');
	}
	return json(users);
};

// POST — create a user
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { email, password, role } = body as Record<string, unknown>;

	if (!email || typeof email !== 'string' || !email.includes('@')) {
		throw error(400, 'Valid email is required');
	}
	if (!password || typeof password !== 'string' || password.length < 8) {
		throw error(400, 'Password must be at least 8 characters');
	}
	if (!role || !VALID_ROLES.includes(role as UserRole)) {
		throw error(400, `Role must be one of: ${VALID_ROLES.join(', ')}`);
	}

	try {
		const user = await getAuthProvider().createUser(email, password, role as UserRole);
		if (user === null) {
			throw error(501, 'User management is not supported in single-password mode.');
		}
		return json(user, { status: 201 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('already exists')) throw error(409, msg);
		throw error(500, 'Failed to create user');
	}
};
