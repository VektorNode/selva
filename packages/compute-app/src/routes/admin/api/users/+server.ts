import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { requireManageUsers } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { PermissionSchema } from '@selva/platform';

const BaseUserBody = z.object({
	email: z.string().email('Valid email is required'),
	permissions: z.array(PermissionSchema)
});
const PasswordUserBody = BaseUserBody.extend({
	password: z.string().min(8, 'Password must be at least 8 characters').optional()
});

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
	const auth = getAuthProvider();

	const body = await request.json().catch(() => null);
	const parsed = PasswordUserBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);
	const { email, password, permissions } = parsed.data;

	try {
		if (auth.passwordAuth) {
			if (!password) throw error(400, 'Password is required');
			const user = await auth.passwordAuth.createUserWithPassword(email, password, permissions);
			return json(user, { status: 201 });
		}
		if (auth.createUser) {
			const user = await auth.createUser(email, permissions);
			return json(user, { status: 201 });
		}
		throw error(501, `User creation is not supported by ${auth.name}. Users are managed externally.`);
	} catch (err) {
		handleApiError(err, 'Failed to create user');
	}
};
